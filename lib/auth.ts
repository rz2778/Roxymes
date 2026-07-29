import { binding, ensureDatabase } from "./data";
import type { DingTalkProfile } from "./dingtalk";
import { getDingTalkConfig } from "./dingtalk";
import type { AppRole, Capability } from "./authorization";
import { hasCapability } from "./authorization";

const SESSION_COOKIE = "sampleflow_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

type AuthEnv = {
  DINGTALK_SUPERVISOR_USER_IDS?: string;
};

export type AuthUser = {
  id: number;
  orgId: number;
  corpId: string;
  dingtalkUserId: string;
  unionId: string | null;
  name: string;
  avatar: string | null;
  role: AppRole;
};

export class RequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

export async function createDingTalkSession(
  request: Request,
  profile: DingTalkProfile,
): Promise<{ user: AuthUser; cookie: string }> {
  if (!profile.active) {
    throw new RequestError("该钉钉成员已停用", 403, "USER_INACTIVE");
  }
  const config = getDingTalkConfig();
  const org = await ensureDatabase(config.corpId, config.orgName);
  const role = resolveRole(profile);
  const db = binding();
  const now = new Date().toISOString();

  await db.prepare(`INSERT INTO users
    (org_id, dingtalk_user_id, union_id, name, avatar, department_ids, role, active, last_login_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(org_id, dingtalk_user_id) DO UPDATE SET
      union_id = excluded.union_id,
      name = excluded.name,
      avatar = excluded.avatar,
      department_ids = excluded.department_ids,
      role = excluded.role,
      active = 1,
      last_login_at = excluded.last_login_at,
      updated_at = excluded.updated_at`)
    .bind(
      org.id,
      profile.userId,
      profile.unionId,
      profile.name,
      profile.avatar,
      JSON.stringify(profile.departmentIds),
      role,
      now,
      now,
    ).run();

  const userRow = await db.prepare(`SELECT id, org_id, dingtalk_user_id, union_id, name, avatar, role
    FROM users WHERE org_id = ? AND dingtalk_user_id = ?`)
    .bind(org.id, profile.userId)
    .first<{
      id: number;
      org_id: number;
      dingtalk_user_id: string;
      union_id: string | null;
      name: string;
      avatar: string | null;
      role: AppRole;
    }>();
  if (!userRow) throw new RequestError("本地成员资料创建失败", 500, "USER_UPSERT_FAILED");

  const rawToken = randomToken();
  const tokenHash = await hashToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1_000).toISOString();
  await db.prepare(`INSERT INTO sessions
    (token_hash, org_id, user_id, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(tokenHash, org.id, userRow.id, expiresAt, now, now).run();

  await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();

  return {
    user: toAuthUser(userRow, config.corpId),
    cookie: serializeSessionCookie(request, rawToken, SESSION_TTL_SECONDS),
  };
}

export async function getSessionUser(request: Request): Promise<AuthUser | null> {
  const config = getDingTalkConfig();
  await ensureDatabase(config.corpId, config.orgName);
  const rawToken = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!rawToken) return null;
  const tokenHash = await hashToken(rawToken);
  const now = new Date().toISOString();
  const db = binding();
  const row = await db.prepare(`SELECT
      u.id, u.org_id, u.dingtalk_user_id, u.union_id, u.name, u.avatar, u.role,
      o.corp_id
    FROM sessions s
    JOIN users u ON u.id = s.user_id AND u.org_id = s.org_id
    JOIN organizations o ON o.id = s.org_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1 AND o.active = 1`)
    .bind(tokenHash, now)
    .first<{
      id: number;
      org_id: number;
      dingtalk_user_id: string;
      union_id: string | null;
      name: string;
      avatar: string | null;
      role: AppRole;
      corp_id: string;
    }>();
  if (!row) return null;

  const configuredCorpId = config.corpId;
  if (row.corp_id !== configuredCorpId) return null;
  await db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?")
    .bind(now, tokenHash).run();
  return toAuthUser(row, row.corp_id);
}

export async function requireUser(
  request: Request,
  capability?: Capability,
): Promise<AuthUser> {
  const user = await getSessionUser(request);
  if (!user) throw new RequestError("请从钉钉工作台重新进入", 401, "AUTH_REQUIRED");
  if (capability && !hasCapability(user.role, capability)) {
    throw new RequestError("你没有执行该操作的权限", 403, "FORBIDDEN");
  }
  return user;
}

export async function revokeSession(request: Request): Promise<void> {
  const rawToken = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!rawToken) return;
  await binding().prepare("DELETE FROM sessions WHERE token_hash = ?")
    .bind(await hashToken(rawToken)).run();
}

export function clearSessionCookie(request: Request): string {
  return serializeSessionCookie(request, "", 0);
}

export function assertSameOrigin(request: Request): void {
  if (request.headers.get("x-sampleflow-request") !== "1") {
    throw new RequestError("缺少应用请求标记", 403, "REQUEST_MARKER_REQUIRED");
  }
  const origin = request.headers.get("origin");
  if (!origin) {
    if (request.headers.get("sec-fetch-site") === "same-origin") return;
    throw new RequestError("缺少可信请求来源信息", 403, "ORIGIN_REQUIRED");
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new RequestError("请求来源无效", 403, "ORIGIN_INVALID");
  }
  if (parsed.origin !== new URL(request.url).origin) {
    throw new RequestError("拒绝跨站请求", 403, "ORIGIN_MISMATCH");
  }
}

export function errorResponse(error: unknown, fallback: string): Response {
  if (error instanceof RequestError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  if (
    typeof candidate?.status === "number" &&
    typeof candidate?.code === "string" &&
    typeof candidate?.message === "string"
  ) {
    return Response.json(
      { error: candidate.message, code: candidate.code },
      { status: candidate.status },
    );
  }
  console.error(fallback, error);
  return Response.json(
    { error: fallback, code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}

function resolveRole(profile: DingTalkProfile): AppRole {
  if (profile.admin) return "admin";
  const runtime = process.env as AuthEnv;
  const supervisors = new Set(
    (runtime.DINGTALK_SUPERVISOR_USER_IDS || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  return supervisors.has(profile.userId) ? "supervisor" : "member";
}

function toAuthUser(
  row: {
    id: number;
    org_id: number;
    dingtalk_user_id: string;
    union_id: string | null;
    name: string;
    avatar: string | null;
    role: AppRole;
  },
  corpId: string,
): AuthUser {
  return {
    id: row.id,
    orgId: row.org_id,
    corpId,
    dingtalkUserId: row.dingtalk_user_id,
    unionId: row.union_id,
    name: row.name,
    avatar: row.avatar,
    role: row.role,
  };
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function serializeSessionCookie(request: Request, value: string, maxAge: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64Url(bytes);
}

async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
