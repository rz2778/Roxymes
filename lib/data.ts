import { env } from "cloudflare:workers";

type D1Env = { DB: D1Database };

function db() {
  const binding = (env as unknown as D1Env).DB;
  if (!binding) throw new Error("D1 数据库尚未绑定");
  return binding;
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS sample_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT NOT NULL UNIQUE,
    customer TEXT NOT NULL,
    merchandiser TEXT NOT NULL,
    due_date TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT '普通',
    sample_type TEXT NOT NULL DEFAULT '开发样',
    status TEXT NOT NULL DEFAULT '待审单',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS styles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    style_id INTEGER NOT NULL REFERENCES styles(id),
    process TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    assignee TEXT NOT NULL,
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
    recipient TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT '系统内',
    status TEXT NOT NULL DEFAULT '待处理',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    before_value TEXT,
    after_value TEXT,
    actor TEXT NOT NULL,
    idempotency_key TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    style_id INTEGER NOT NULL REFERENCES styles(id),
    version INTEGER NOT NULL,
    object_key TEXT NOT NULL,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS process_tasks_style_idx ON process_tasks(style_id)",
  "CREATE INDEX IF NOT EXISTS styles_order_idx ON styles(order_id)",
  "CREATE INDEX IF NOT EXISTS notifications_status_idx ON notifications(status)",
];

export async function ensureDatabase() {
  const binding = db();
  await binding.batch(schemaStatements.map((statement) => binding.prepare(statement)));
  const count = await binding.prepare("SELECT COUNT(*) AS count FROM sample_orders").first<{ count: number }>();
  if ((count?.count ?? 0) > 0) return;

  await binding.batch([
    binding.prepare("INSERT INTO sample_orders (order_no, customer, merchandiser, due_date, priority, sample_type, status) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("YP-260728-001", "Morrow Studio", "林雪", "2026-07-30", "紧急", "确认样", "生产中"),
    binding.prepare("INSERT INTO sample_orders (order_no, customer, merchandiser, due_date, priority, sample_type, status) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("YP-260728-002", "Nordlicht", "陈璐", "2026-08-02", "普通", "开发样", "生产中"),
    binding.prepare("INSERT INTO sample_orders (order_no, customer, merchandiser, due_date, priority, sample_type, status) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("YP-260727-009", "Parallel Goods", "林雪", "2026-07-29", "普通", "销售样", "异常"),
  ]);

  const orderRows = await binding.prepare("SELECT id, order_no FROM sample_orders ORDER BY id").all<{ id: number; order_no: string }>();
  const orderMap = new Map(orderRows.results.map((row) => [row.order_no, row.id]));
  await binding.batch([
    binding.prepare("INSERT INTO styles (order_id, style_no, color, size, quantity, version, main_image, status, current_process) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(orderMap.get("YP-260728-001"), "SL-081", "雾灰", "39", 2, 2, "mint", "生产中", "针车"),
    binding.prepare("INSERT INTO styles (order_id, style_no, color, size, quantity, version, main_image, status, current_process) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(orderMap.get("YP-260728-001"), "SL-081", "奶油白", "38", 1, 1, "sand", "生产中", "切割"),
    binding.prepare("INSERT INTO styles (order_id, style_no, color, size, quantity, version, main_image, status, current_process) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(orderMap.get("YP-260728-002"), "MT-220", "深海蓝", "42", 2, 1, "navy", "生产中", "备料"),
    binding.prepare("INSERT INTO styles (order_id, style_no, color, size, quantity, version, main_image, status, current_process) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(orderMap.get("YP-260727-009"), "WK-104", "栗棕", "40", 1, 1, "clay", "异常", "加工"),
  ]);

  const styleRows = await binding.prepare("SELECT id, style_no, color FROM styles ORDER BY id").all<{ id: number; style_no: string; color: string }>();
  const style = (styleNo: string, color: string) => styleRows.results.find((row) => row.style_no === styleNo && row.color === color)!.id;
  const taskRows: Array<[number, string, number, string, string]> = [
    [style("SL-081", "雾灰"), "备料", 1, "周师傅", "已完成"],
    [style("SL-081", "雾灰"), "开版", 1, "李师傅", "已完成"],
    [style("SL-081", "雾灰"), "切割", 2, "王师傅", "已完成"],
    [style("SL-081", "雾灰"), "加工", 3, "赵师傅", "已完成"],
    [style("SL-081", "雾灰"), "针车", 4, "孙师傅", "进行中"],
    [style("SL-081", "雾灰"), "成型", 5, "钱师傅", "等待前置工序"],
    [style("SL-081", "奶油白"), "备料", 1, "周师傅", "已完成"],
    [style("SL-081", "奶油白"), "开版", 1, "李师傅", "已完成"],
    [style("SL-081", "奶油白"), "切割", 2, "王师傅", "待开始"],
    [style("SL-081", "奶油白"), "加工", 3, "赵师傅", "等待前置工序"],
    [style("SL-081", "奶油白"), "针车", 4, "孙师傅", "等待前置工序"],
    [style("SL-081", "奶油白"), "成型", 5, "钱师傅", "等待前置工序"],
    [style("MT-220", "深海蓝"), "备料", 1, "周师傅", "进行中"],
    [style("MT-220", "深海蓝"), "开版", 1, "李师傅", "待开始"],
    [style("MT-220", "深海蓝"), "切割", 2, "王师傅", "等待前置工序"],
    [style("MT-220", "深海蓝"), "加工", 3, "赵师傅", "等待前置工序"],
    [style("MT-220", "深海蓝"), "针车", 4, "孙师傅", "等待前置工序"],
    [style("MT-220", "深海蓝"), "成型", 5, "钱师傅", "等待前置工序"],
    [style("WK-104", "栗棕"), "备料", 1, "周师傅", "已完成"],
    [style("WK-104", "栗棕"), "开版", 1, "李师傅", "已完成"],
    [style("WK-104", "栗棕"), "切割", 2, "王师傅", "已完成"],
    [style("WK-104", "栗棕"), "加工", 3, "赵师傅", "异常"],
    [style("WK-104", "栗棕"), "针车", 4, "孙师傅", "等待前置工序"],
    [style("WK-104", "栗棕"), "成型", 5, "钱师傅", "等待前置工序"],
  ];
  await binding.batch(taskRows.map((row) =>
    binding.prepare("INSERT INTO process_tasks (style_id, process, sequence, assignee, status, planned_start, planned_end) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(...row, "2026-07-28 08:00", "2026-07-29 18:00")
  ));
  await binding.batch([
    binding.prepare("INSERT INTO change_records (style_id, from_version, to_version, reason, content, applicant, status) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(style("SL-081", "雾灰"), 1, 2, "客户要求", "鞋带孔位置上移 3mm；主效果图已更新。", "林雪", "待主管处理"),
    binding.prepare("INSERT INTO notifications (recipient, title, body, channel, status) VALUES (?, ?, ?, ?, ?)").bind("赵主管", "客户变更待评估", "SL-081 雾灰已更新至 V2，请评估影响。", "系统内（钉钉待联调）", "待处理"),
    binding.prepare("INSERT INTO audit_logs (entity_type, entity_id, action, after_value, actor) VALUES (?, ?, ?, ?, ?)").bind("样品款式", style("SL-081", "雾灰"), "提交客户变更", "V1 → V2", "林雪"),
  ]);
}

export function binding() {
  return db();
}
