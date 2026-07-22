import type {
  AppContentBlock,
  AdminSession,
  AdminUser,
  AdminUserProfile,
  ModelControl,
  Pagination,
  Statistics,
} from './types';

const DEFAULT_API_BASE_URL = 'https://astesia.cc';
const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL);
const SESSION_STORAGE_KEY = 'astesia-admin-session';

type ErrorPayload = {
  error?: unknown;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * 使用邮箱密码登录，并要求接口响应包含管理员身份。
 *
 * @param email - 管理员邮箱
 * @param password - 登录密码
 * @returns 可用于后续管理接口的会话
 * @example
 *   await loginAdmin('admin@example.com', 'password')
 */
export async function loginAdmin(email: string, password: string) {
  const payload = await requestJson<{
    token?: unknown;
    user?: unknown;
  }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }),
  });
  const token = normalizeString(payload.token);
  const user = normalizeAdminProfile(payload.user);

  if (!token || !user) {
    throw new ApiError('登录响应不完整，请稍后重试。', 502);
  }

  if (user.role !== 'admin') {
    throw new ApiError('当前账号不是管理员，无法进入控制台。', 403);
  }

  const session = { token, user } satisfies AdminSession;
  const verifiedUser = await getAdminSession(session);
  const verifiedSession = { token, user: verifiedUser } satisfies AdminSession;
  saveAdminSession(verifiedSession);
  return verifiedSession;
}

export async function getAdminSession(session: AdminSession) {
  const payload = await requestAdminJson<{ user?: unknown }>(
    '/api/admin/session',
    session,
  );
  const user = normalizeAdminProfile(payload.user);

  if (!user || user.role !== 'admin') {
    throw new ApiError('管理员会话校验失败。', 403);
  }

  return user;
}

export async function getStatistics(session: AdminSession) {
  return requestAdminJson<Statistics>(
    '/api/admin/ai/statistics?userLimit=100&topLimit=10',
    session,
  );
}

export async function getUsers(
  session: AdminSession,
  params: { page: number; pageSize: number; query: string },
) {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });

  if (params.query.trim()) {
    searchParams.set('query', params.query.trim());
  }

  return requestAdminJson<{ users: AdminUser[]; pagination: Pagination }>(
    `/api/admin/users?${searchParams.toString()}`,
    session,
  );
}

export async function updateUserQuota(
  session: AdminSession,
  user: AdminUser,
  quotaLimitUsd: number,
) {
  return requestAdminJson<{ user: AdminUser }>(
    `/api/admin/users/${encodeURIComponent(user.userId)}/quota`,
    session,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quotaLimitUsd,
        updatedAt: user.updatedAt,
      }),
    },
  );
}

export async function getModelControls(session: AdminSession) {
  return requestAdminJson<{ models: ModelControl[] }>('/api/admin/ai/models', session);
}

export async function updateModelControl(
  session: AdminSession,
  model: string,
  enabled: boolean,
) {
  return requestAdminJson<{ model: ModelControl }>(
    `/api/admin/ai/models/${encodeURIComponent(model)}`,
    session,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    },
  );
}

export async function getAppContentBlocks(session: AdminSession) {
  return requestAdminJson<{ contents: AppContentBlock[] }>('/api/admin/app/content', session);
}

export async function updateAppContentBlock(
  session: AdminSession,
  contentBlock: AppContentBlock,
  nextValue: { title: string; content: string },
) {
  return requestAdminJson<{ content: AppContentBlock }>(
    `/api/admin/app/content/${encodeURIComponent(contentBlock.key)}`,
    session,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: nextValue.title,
        content: nextValue.content,
        updatedAt: contentBlock.updatedAt,
      }),
    },
  );
}

export function loadAdminSession() {
  try {
    const storedSession = sessionStorage.getItem(SESSION_STORAGE_KEY);

    if (!storedSession) {
      return null;
    }

    const parsedSession = JSON.parse(storedSession) as Partial<AdminSession>;
    const token = normalizeString(parsedSession.token);
    const user = normalizeAdminProfile(parsedSession.user);

    return token && user?.role === 'admin'
      ? ({ token, user } satisfies AdminSession)
      : null;
  } catch {
    return null;
  }
}

export function saveAdminSession(session: AdminSession) {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearAdminSession() {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

async function requestAdminJson<T>(
  pathname: string,
  session: AdminSession,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.token}`);
  headers.set('X-AI-User-Id', session.user.userId);

  return requestJson<T>(pathname, { ...init, headers });
}

async function requestJson<T>(pathname: string, init: RequestInit = {}) {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${pathname}`, init);
  } catch {
    throw new ApiError('无法连接 Astesia 服务，请检查网络或服务地址。', 0);
  }

  const payload = await response.json().catch(() => ({})) as T & ErrorPayload;

  if (!response.ok) {
    const message = typeof payload.error === 'string'
      ? payload.error
      : '请求处理失败，请稍后重试。';
    throw new ApiError(message, response.status);
  }

  return payload;
}

function normalizeApiBaseUrl(value: unknown) {
  const normalizedValue = normalizeString(value).replace(/\/+$/, '');
  const candidate = normalizedValue || DEFAULT_API_BASE_URL;

  try {
    const url = new URL(candidate);
    const isLocalHttp = url.protocol === 'http:'
      && ['localhost', '127.0.0.1'].includes(url.hostname);

    // [变更] 修改前: 构建变量只做字符串清理，任何协议都可能成为鉴权请求目标
    // [变更] 修改后: 生产仅允许 HTTPS，HTTP 只放行本机开发地址
    // [原因] 管理端请求会携带管理员 Token，必须限制凭证可发送的协议范围
    if (url.protocol !== 'https:' && !isLocalHttp) {
      return DEFAULT_API_BASE_URL;
    }

    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return DEFAULT_API_BASE_URL;
  }
}

function normalizeAdminProfile(value: unknown): AdminUserProfile | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const profile = value as Partial<AdminUserProfile>;
  const userId = normalizeString(profile.userId);
  const email = normalizeString(profile.email).toLowerCase();
  const role = normalizeString(profile.role);

  if (!userId || !email || !role) {
    return null;
  }

  return {
    userId,
    email,
    role,
    name: normalizeString(profile.name) || email.split('@')[0] || '管理员',
    planName: normalizeString(profile.planName) || '普通计划',
  };
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}
