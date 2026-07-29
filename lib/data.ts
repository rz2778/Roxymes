import { neon } from "@neondatabase/serverless";

type QueryResult<T = Record<string, unknown>> = {
  results: T[];
  meta: { changes?: number; last_row_id?: number | string };
};

export type DatabaseLike = {
  prepare(query: string): {
    run(): Promise<QueryResult>;
    first<T>(): Promise<T | null>;
    all<T>(): Promise<QueryResult<T>>;
    bind(...values: unknown[]): {
      run(): Promise<QueryResult>;
      first<T>(): Promise<T | null>;
      all<T>(): Promise<QueryResult<T>>;
    };
  };
  batch(statements: unknown[]): Promise<QueryResult[]>;
};

export type Organization = {
  id: number;
  corpId: string;
  name: string;
};

let schemaPromise: Promise<void> | null = null;
let database: DatabaseLike | null = null;

type NeonResult = { rows?: Record<string, unknown>[]; rowCount?: number };

function postgresQuery(query: string, values: unknown[]): Promise<NeonResult> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("数据库尚未连接。请在 Vercel Marketplace 中添加 Neon Postgres 后配置 DATABASE_URL。");
  const sql = neon(connectionString, { fullResults: true });
  const postgresQuery = query
    .replaceAll("INTEGER PRIMARY KEY AUTOINCREMENT", "BIGSERIAL PRIMARY KEY")
    .replaceAll("?", (_, index) => `$${index + 1}`);
  return sql.query(postgresQuery, values) as Promise<NeonResult>;
}

class PostgresStatement {
  constructor(private readonly query: string, private readonly values: unknown[] = []) {}
  bind(...values: unknown[]) { return new PostgresStatement(this.query, values); }
  async run(): Promise<QueryResult> {
    const result = await postgresQuery(this.query, this.values);
    const firstRow = result.rows?.[0] as { id?: number } | undefined;
    return { results: result.rows || [], meta: { changes: result.rowCount || 0, last_row_id: firstRow?.id } };
  }
  async first<T>(): Promise<T | null> {
    const result = await postgresQuery(this.query, this.values);
    return (result.rows?.[0] as T | undefined) || null;
  }
  async all<T>(): Promise<QueryResult<T>> {
    const result = await postgresQuery(this.query, this.values);
    return { results: (result.rows || []) as T[], meta: { changes: result.rowCount || 0 } };
  }
}

function db(): DatabaseLike {
  if (database) return database;
  database = {
    prepare(query) { return new PostgresStatement(query); },
    async batch(statements) { return Promise.all((statements as PostgresStatement[]).map((statement) => statement.run())); },
  };
  return database;
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    corp_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES organizations(id),
    dingtalk_user_id TEXT NOT NULL,
    union_id TEXT,
    name TEXT NOT NULL,
    avatar TEXT,
    department_ids TEXT NOT NULL DEFAULT '[]',
    role TEXT NOT NULL DEFAULT 'member',
    active INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(org_id, dingtalk_user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    org_id INTEGER NOT NULL REFERENCES organizations(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS sample_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES organizations(id),
    order_no TEXT NOT NULL,
    customer TEXT NOT NULL,
    merchandiser TEXT NOT NULL,
    due_date TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT '普通',
    sample_type TEXT NOT NULL DEFAULT '开发样',
    status TEXT NOT NULL DEFAULT '待审单',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(org_id, order_no)
  )`,
  `CREATE TABLE IF NOT EXISTS styles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES organizations(id),
    order_id INTEGER NOT NULL REFERENCES sample_orders(id),
    style_no TEXT NOT NULL,
    color TEXT NOT NULL,
    size TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    main_image TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '待审单',
    current_process TEXT NOT NULL DEFAULT '审单'
  )`,
  `CREATE TABLE IF NOT EXISTS process_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES organizations(id),
    style_id INTEGER NOT NULL REFERENCES styles(id),
    process TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    assignee TEXT NOT NULL,
    assignee_user_id INTEGER REFERENCES users(id),
    status TEXT NOT NULL,
    planned_start TEXT,
    planned_end TEXT,
    actual_start TEXT,
    actual_end TEXT,
    pause_reason TEXT,
    exception_note TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    row_version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS change_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES organizations(id),
    style_id INTEGER NOT NULL REFERENCES styles(id),
    from_version INTEGER NOT NULL,
    to_version INTEGER NOT NULL,
    reason TEXT NOT NULL,
    content TEXT NOT NULL,
    applicant TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '待主管处理',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES organizations(id),
    recipient TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT '系统内',
    status TEXT NOT NULL DEFAULT '待处理',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES organizations(id),
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    before_value TEXT,
    after_value TEXT,
    actor TEXT NOT NULL,
    actor_user_id INTEGER REFERENCES users(id),
    idempotency_key TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(org_id, idempotency_key)
  )`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES organizations(id),
    style_id INTEGER NOT NULL REFERENCES styles(id),
    version INTEGER NOT NULL,
    object_key TEXT NOT NULL,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    uploaded_by_user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

const indexes = [
  "CREATE INDEX IF NOT EXISTS users_org_idx ON users(org_id, active)",
  "CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at)",
  "CREATE INDEX IF NOT EXISTS orders_org_due_idx ON sample_orders(org_id, due_date)",
  "CREATE INDEX IF NOT EXISTS styles_org_order_idx ON styles(org_id, order_id)",
  "CREATE INDEX IF NOT EXISTS tasks_org_style_idx ON process_tasks(org_id, style_id)",
  "CREATE INDEX IF NOT EXISTS tasks_org_assignee_idx ON process_tasks(org_id, assignee_user_id, status)",
  "CREATE INDEX IF NOT EXISTS changes_org_style_idx ON change_records(org_id, style_id)",
  "CREATE INDEX IF NOT EXISTS notifications_org_status_idx ON notifications(org_id, status)",
  "CREATE INDEX IF NOT EXISTS audits_org_created_idx ON audit_logs(org_id, created_at)",
  "CREATE INDEX IF NOT EXISTS attachments_org_style_idx ON attachments(org_id, style_id)",
];

const tenantTables = [
  "sample_orders",
  "styles",
  "process_tasks",
  "change_records",
  "notifications",
  "audit_logs",
  "attachments",
] as const;

export async function ensureDatabase(corpId: string, orgName: string): Promise<Organization> {
  const targetCorpId = corpId.trim();
  if (!targetCorpId) throw new Error("缺少目标钉钉组织 CorpId");
  if (!schemaPromise) {
    schemaPromise = prepareSchema().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;

  const database = db();
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO organizations (corp_id, name, active, updated_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(corp_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`)
    .bind(targetCorpId, orgName.trim() || targetCorpId, now).run();
  const org = await database.prepare("SELECT id, corp_id, name FROM organizations WHERE corp_id = ? AND active = 1")
    .bind(targetCorpId)
    .first<{ id: number; corp_id: string; name: string }>();
  if (!org) throw new Error("目标组织初始化失败");

  // Existing single-organization MVP rows are safely claimed by the configured target org.
  await database.batch(tenantTables.map((table) =>
    database.prepare(`UPDATE ${table} SET org_id = ? WHERE org_id IS NULL`).bind(org.id)
  ));

  return { id: org.id, corpId: org.corp_id, name: org.name };
}

async function prepareSchema(): Promise<void> {
  const database = db();
  await database.batch(schemaStatements.map((statement) => database.prepare(statement)));

  await database.batch(indexes.map((statement) => database.prepare(statement)));
}

export function binding(): DatabaseLike {
  return db();
}
