import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { storage } from '@/services/storage';
import { AUTH_USER_PROFILE_STORAGE_KEY } from '@/services/storage-keys';
import { userStore } from '@/services/store/userStore';
import type { User } from '@/services/types/user';

const DEFAULT_AUTH_API_HOST = Platform.OS === 'android'
  ? 'http://10.0.2.2:8787'
  : 'http://127.0.0.1:8787';

const AUTH_API_HOST = resolveApiHost(process.env.EXPO_PUBLIC_AI_API_HOST);
const USER_TOKEN_STORAGE_KEY = 'userToken';
const USER_ID_STORAGE_KEY = 'userId';
const AI_USER_ID_HEADER = 'X-AI-User-Id';
// [变更] 修改前: 前端默认计划名沿用 Free
// [变更] 修改后: 默认计划统一展示为“普通计划”
// [原因] 当前阶段未接入支付渠道，登录后计划文案需要与服务端保持一致
const DEFAULT_PLAN_NAME = '普通计划';

type AuthResponse = {
  token?: unknown;
  user?: unknown;
  error?: unknown;
};

type BillingSummaryResponse = {
  balanceUsd?: unknown;
  totalChargedUsd?: unknown;
  totalTokens?: unknown;
  error?: unknown;
};

export type AuthUserProfile = User & {
  planName: string;
  signature: string;
  avatarUrl?: string | null;
};

export type AuthSession = {
  token: string;
  user: AuthUserProfile;
};

export type AiQuotaSummary = {
  remainingBalanceUsd: string;
  totalChargedUsd: string;
  totalTokens: number;
};

/**
 * 加载当前登录会话，优先恢复本地 token 与用户资料，并同步回 userStore。
 *
 * @returns 当前已登录会话；若未登录则返回 null
 * @example
 *   const session = await loadAuthSession();
 */
export async function loadAuthSession() {
  const [token, storedProfile, storedUserId] = await Promise.all([
    readIdentityValue(USER_TOKEN_STORAGE_KEY),
    storage.getItem(AUTH_USER_PROFILE_STORAGE_KEY),
    readIdentityValue(USER_ID_STORAGE_KEY),
  ]);

  const normalizedToken = normalizeStoredString(token);
  const normalizedUserId = normalizeStoredString(storedUserId);

  if (!normalizedToken || !storedProfile) {
    userStore.setUser(null);
    return null;
  }

  try {
    const parsedProfile = JSON.parse(storedProfile);
    const user = normalizeAuthUserProfile(parsedProfile, normalizedUserId);

    if (!user) {
      userStore.setUser(null);
      return null;
    }

    userStore.setUser(user);
    return { token: normalizedToken, user } satisfies AuthSession;
  } catch {
    userStore.setUser(null);
    return null;
  }
}

/**
 * 发送注册验证码。当前为最小可运行闭环，后端返回验证码后由前端提示用户输入。
 *
 * @param email - 用户邮箱
 * @returns 本次验证码发送结果
 * @example
 *   await requestRegisterCode('demo@example.com')
 */
export async function requestRegisterCode(email: string) {
  const response = await fetch(`${AUTH_API_HOST}/api/auth/register/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim() }),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : '验证码发送失败。');
  }

  const verificationCode = normalizeStoredString(data.verificationCode);
  return {
    message: typeof data.message === 'string' ? data.message : '验证码已生成。',
    verificationCode,
  };
}

/**
 * 使用邮箱、验证码和密码完成注册，并写入本地登录态。
 *
 * @param email - 注册邮箱
 * @param verificationCode - 验证码
 * @param password - 登录密码
 * @returns 已写入本地的登录会话
 * @example
 *   await registerWithEmailCode('demo@example.com', '123456', 'password123')
 */
export async function registerWithEmailCode(email: string, verificationCode: string, password: string) {
  return createSessionFromResponse(await requestAuth('/api/auth/register', {
    email,
    verificationCode,
    password,
  }));
}

/**
 * 使用邮箱和密码登录，并写入本地登录态。
 *
 * @param email - 登录邮箱
 * @param password - 登录密码
 * @returns 已写入本地的登录会话
 * @example
 *   await loginWithEmailPassword('demo@example.com', 'password123')
 */
export async function loginWithEmailPassword(email: string, password: string) {
  return createSessionFromResponse(await requestAuth('/api/auth/login', {
    email,
    password,
  }));
}

/**
 * 清理当前登录会话，并同步清空内存中的用户信息。
 *
 * @returns Promise<void>
 * @example
 *   await clearAuthSession()
 */
export async function clearAuthSession() {
  await Promise.all([
    storage.removeItem(USER_TOKEN_STORAGE_KEY),
    storage.removeItem(USER_ID_STORAGE_KEY),
    storage.removeItem(AUTH_USER_PROFILE_STORAGE_KEY),
    AsyncStorage.removeItem(USER_TOKEN_STORAGE_KEY),
    AsyncStorage.removeItem(USER_ID_STORAGE_KEY),
  ]);

  userStore.setUser(null);
}

/**
 * 获取当前登录用户的 AI 剩余额度与累计消耗，用于个人页展示。
 *
 * @returns 额度摘要；未登录时返回 null
 * @example
 *   const summary = await getAiQuotaSummary()
 */
export async function getAiQuotaSummary() {
  const session = await loadAuthSession();

  if (!session) {
    return null;
  }

  const requestHeaders = new Headers({
    Authorization: `Bearer ${session.token}`,
    [AI_USER_ID_HEADER]: String(session.user.userId),
  });

  const response = await fetch(`${AUTH_API_HOST}/api/ai/billing/summary`, {
    headers: requestHeaders,
  });
  const data = await response.json().catch(() => ({})) as BillingSummaryResponse;

  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'AI 额度获取失败。');
  }

  return {
    remainingBalanceUsd: normalizeCurrencyText(data.balanceUsd),
    totalChargedUsd: normalizeCurrencyText(data.totalChargedUsd),
    totalTokens: normalizeNonNegativeInteger(data.totalTokens),
  } satisfies AiQuotaSummary;
}

async function requestAuth(pathname: string, payload: Record<string, unknown>) {
  const response = await fetch(`${AUTH_API_HOST}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({})) as AuthResponse;

  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : '登录失败。');
  }

  return data;
}

async function createSessionFromResponse(data: AuthResponse) {
  const normalizedToken = normalizeStoredString(data.token);
  const normalizedUser = normalizeAuthUserProfile(data.user);

  if (!normalizedToken || !normalizedUser) {
    throw new Error('登录信息不完整，请稍后重试。');
  }

  await persistAuthSession({
    token: normalizedToken,
    user: normalizedUser,
  });

  return {
    token: normalizedToken,
    user: normalizedUser,
  } satisfies AuthSession;
}

async function persistAuthSession(session: AuthSession) {
  const userIdText = String(session.user.userId);

  await Promise.all([
    storage.setItem(USER_TOKEN_STORAGE_KEY, session.token),
    storage.setItem(USER_ID_STORAGE_KEY, userIdText),
    storage.setItem(AUTH_USER_PROFILE_STORAGE_KEY, JSON.stringify(session.user)),
    AsyncStorage.setItem(USER_TOKEN_STORAGE_KEY, session.token),
    AsyncStorage.setItem(USER_ID_STORAGE_KEY, userIdText),
  ]);

  userStore.setUser(session.user);
}

async function readIdentityValue(key: string) {
  const [secureValue, asyncValue] = await Promise.all([
    storage.getItem(key),
    AsyncStorage.getItem(key),
  ]);

  return secureValue ?? asyncValue;
}

function normalizeAuthUserProfile(value: unknown, fallbackUserId?: string) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const user = value as Partial<AuthUserProfile>;
  const normalizedUserId = normalizeUserId(user.userId ?? fallbackUserId);
  const normalizedEmail = normalizeEmail(user.email);

  if (!normalizedUserId || !normalizedEmail) {
    return null;
  }

  const normalizedName = normalizeStoredString(user.name) || getDefaultUserName(normalizedEmail);

  return {
    userId: normalizedUserId,
    name: normalizedName,
    email: normalizedEmail,
    role: normalizeStoredString(user.role) || 'user',
    // [变更] 修改前: 直接透传本地缓存或接口返回的 planName，历史会话会继续展示 Free
    // [变更] 修改后: 统一将空值和历史 Free 归一为“普通计划”
    // [原因] 保证老会话、本地缓存和新登录响应的计划展示口径一致
    planName: normalizePlanName(user.planName),
    signature: normalizeStoredString(user.signature) || '欢迎来到 Astesia',
    avatarUrl: normalizeOptionalAvatarUrl(user.avatarUrl),
  } satisfies AuthUserProfile;
}

function normalizeUserId(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  return normalizeStoredString(value);
}

function normalizeEmail(value: unknown) {
  const email = normalizeStoredString(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

/**
 * 统一归一化登录态中的计划名称，兼容历史 Free 文案并回退到当前默认计划
 *
 * @param value - 本地缓存或接口返回的原始计划名称
 * @returns 当前页面可直接展示的计划名称
 * @example
 *   normalizePlanName('Free') // => '普通计划'
 */
function normalizePlanName(value: unknown) {
  const normalizedPlanName = normalizeStoredString(value);

  if (!normalizedPlanName) {
    return DEFAULT_PLAN_NAME;
  }

  return normalizedPlanName.toLowerCase() === 'free'
    ? DEFAULT_PLAN_NAME
    : normalizedPlanName;
}

function normalizeStoredString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalAvatarUrl(value: unknown) {
  const avatarUrl = normalizeStoredString(value);
  return avatarUrl || null;
}

function normalizeCurrencyText(value: unknown) {
  const currencyText = normalizeStoredString(value);
  return currencyText || '0';
}

function normalizeNonNegativeInteger(value: unknown) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? Math.floor(numericValue) : 0;
}

function getDefaultUserName(email: string) {
  const [localPart] = email.split('@');
  return localPart || 'Astesia 用户';
}

function normalizeApiHost(value?: string) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/[`'"]/g, '').replace(/\/+$/, '');
}

function resolveApiHost(value?: string) {
  const normalizedHost = normalizeApiHost(value);

  if (!normalizedHost) {
    return DEFAULT_AUTH_API_HOST;
  }

  if (Platform.OS === 'android') {
    return normalizedHost
      .replace('://127.0.0.1', '://10.0.2.2')
      .replace('://localhost', '://10.0.2.2');
  }

  return normalizedHost;
}
