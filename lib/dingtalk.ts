
export interface DingTalkMessage {
  recipient: string;
  title: string;
  body: string;
}

export interface DingTalkProfile {
  userId: string;
  unionId: string | null;
  name: string;
  avatar: string | null;
  departmentIds: number[];
  active: boolean;
  admin: boolean;
}

type DingTalkEnv = {
  DINGTALK_CORP_ID?: string;
  DINGTALK_APP_KEY?: string;
  DINGTALK_APP_SECRET?: string;
  DINGTALK_AGENT_ID?: string;
  DINGTALK_ORG_NAME?: string;
};

type AccessTokenResponse = {
  accessToken?: string;
  expireIn?: number;
  code?: string;
  message?: string;
};

type TopApiResponse<T> = {
  errcode?: number;
  errmsg?: string;
  result?: T;
};

type TokenCache = {
  value: string;
  expiresAt: number;
};

const ACCESS_TOKEN_URL = "https://api.dingtalk.com/v1.0/oauth2/accessToken";
const USER_BY_CODE_URL = "https://oapi.dingtalk.com/topapi/v2/user/getuserinfo";
const USER_DETAIL_URL = "https://oapi.dingtalk.com/topapi/v2/user/get";
const REQUEST_TIMEOUT_MS = 8_000;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1_000;

let tokenCache: TokenCache | null = null;
let tokenRequest: Promise<string> | null = null;

export class DingTalkError extends Error {
  constructor(
    message: string,
    public readonly code = "DINGTALK_ERROR",
    public readonly status = 502,
  ) {
    super(message);
  }
}

export function getDingTalkConfig() {
  const runtime = process.env as DingTalkEnv;
  const corpId = runtime.DINGTALK_CORP_ID?.trim();
  const appKey = runtime.DINGTALK_APP_KEY?.trim();
  const appSecret = runtime.DINGTALK_APP_SECRET?.trim();
  if (!corpId || !appKey || !appSecret) {
    throw new DingTalkError("钉钉应用凭证尚未配置", "DINGTALK_NOT_CONFIGURED", 503);
  }
  return {
    corpId,
    appKey,
    appSecret,
    agentId: runtime.DINGTALK_AGENT_ID?.trim() || null,
    orgName: runtime.DINGTALK_ORG_NAME?.trim() || "温州市金丽伦鞋业有限公司",
  };
}

export function getPublicDingTalkConfig() {
  const config = getDingTalkConfig();
  return {
    corpId: config.corpId,
    agentId: config.agentId,
    orgName: config.orgName,
  };
}

export async function exchangeAuthCode(authCode: string): Promise<DingTalkProfile> {
  const code = authCode.trim();
  if (!code || code.length > 512) {
    throw new DingTalkError("免登授权码无效", "INVALID_AUTH_CODE", 400);
  }

  let accessToken = await getAccessToken();
  try {
    return await fetchProfile(code, accessToken);
  } catch (error) {
    if (!(error instanceof DingTalkError) || error.code !== "INVALID_ACCESS_TOKEN") {
      throw error;
    }
    tokenCache = null;
    accessToken = await getAccessToken(true);
    return fetchProfile(code, accessToken);
  }
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && tokenCache && tokenCache.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
    return tokenCache.value;
  }
  if (!forceRefresh && tokenRequest) return tokenRequest;

  tokenRequest = requestAccessToken();
  try {
    return await tokenRequest;
  } finally {
    tokenRequest = null;
  }
}

async function requestAccessToken(): Promise<string> {
  const config = getDingTalkConfig();
  const response = await dingTalkFetch(ACCESS_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appKey: config.appKey, appSecret: config.appSecret }),
  });
  const payload = await readJson<AccessTokenResponse>(response);
  if (!response.ok || !payload.accessToken) {
    throw new DingTalkError(
      payload.message || "获取钉钉企业访问凭证失败",
      payload.code || "ACCESS_TOKEN_FAILED",
    );
  }
  const ttlSeconds = Math.max(300, Number(payload.expireIn) || 7_200);
  tokenCache = {
    value: payload.accessToken,
    expiresAt: Date.now() + ttlSeconds * 1_000,
  };
  return payload.accessToken;
}

async function fetchProfile(code: string, accessToken: string): Promise<DingTalkProfile> {
  const identity = await topApi<{ userid?: string }>(
    USER_BY_CODE_URL,
    accessToken,
    { code },
  );
  const userId = identity.userid?.trim();
  if (!userId) {
    throw new DingTalkError("钉钉未返回有效成员身份", "USER_ID_MISSING");
  }

  const detail = await topApi<{
    userid?: string;
    unionid?: string;
    name?: string;
    avatar?: string;
    dept_id_list?: number[];
    active?: boolean;
    admin?: boolean;
  }>(USER_DETAIL_URL, accessToken, { userid: userId, language: "zh_CN" });

  const name = detail.name?.trim();
  if (!name) {
    throw new DingTalkError("钉钉成员资料缺少姓名", "USER_PROFILE_INVALID");
  }
  return {
    userId,
    unionId: detail.unionid?.trim() || null,
    name,
    avatar: detail.avatar?.trim() || null,
    departmentIds: Array.isArray(detail.dept_id_list)
      ? detail.dept_id_list.filter((item) => Number.isFinite(item))
      : [],
    active: detail.active !== false,
    admin: detail.admin === true,
  };
}

async function topApi<T>(
  baseUrl: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<T> {
  const url = new URL(baseUrl);
  url.searchParams.set("access_token", accessToken);
  const response = await dingTalkFetch(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await readJson<TopApiResponse<T>>(response);
  const errorCode = Number(payload.errcode ?? 0);
  if (!response.ok || errorCode !== 0 || !payload.result) {
    const invalidTokenCodes = new Set([40014, 42001, 88]);
    throw new DingTalkError(
      payload.errmsg || "钉钉成员接口调用失败",
      invalidTokenCodes.has(errorCode) ? "INVALID_ACCESS_TOKEN" : `DINGTALK_${errorCode || response.status}`,
    );
  }
  return payload.result;
}

async function dingTalkFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new DingTalkError("钉钉服务响应超时", "DINGTALK_TIMEOUT", 504);
    }
    throw new DingTalkError("无法连接钉钉服务", "DINGTALK_NETWORK_ERROR", 502);
  } finally {
    clearTimeout(timer);
  }
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    throw new DingTalkError("钉钉服务返回了无效响应", "DINGTALK_INVALID_RESPONSE");
  }
}

/**
 * 消息适配仍以系统内通知兜底。正式申请工作通知权限后，可在此边界接入 AgentId。
 */
export async function sendDingTalkMessage(message: DingTalkMessage) {
  return {
    channel: "系统内（钉钉消息待启用）",
    status: "待处理",
    ...message,
  };
}
