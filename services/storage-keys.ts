export const APP_SETTINGS_STORAGE_KEY = 'astesia-app-settings';
export const LOCAL_BACKUP_STORAGE_KEY = 'astesia-local-backup';
export const RECENT_CITIES_STORAGE_KEY = 'recent-weather-cities';
export const PENDING_CITY_SELECTION_STORAGE_KEY = 'pending-weather-city-selection';
export const ACCOUNTING_ENTRIES_STORAGE_KEY = 'astesia-accounting-entries';
export const ACCOUNTING_MONTHLY_BUDGET_STORAGE_KEY = 'astesia-accounting-monthly-budget';
export const ACCOUNTING_HERO_IMAGE_STORAGE_KEY = 'astesia-accounting-hero-image';
export const ACCOUNTING_TOTAL_ASSET_STORAGE_KEY = 'astesia-accounting-total-asset';
export const NOTES_STORAGE_KEY = 'astesia-notes';
export const TODO_ITEMS_STORAGE_KEY = 'astesia-todo-items';
export const PERSONAL_BACKGROUND_IMAGE_STORAGE_KEY = 'astesia-personal-background-image';
export const AI_ASSISTANT_MESSAGES_STORAGE_KEY = 'astesia-ai-assistant-messages';
export const AI_ASSISTANT_CONVERSATIONS_STORAGE_KEY = 'astesia-ai-assistant-conversations';
export const AUTH_USER_PROFILE_STORAGE_KEY = 'astesia-auth-user-profile';

export const EXPORTABLE_STORAGE_KEYS = [
  APP_SETTINGS_STORAGE_KEY,
  RECENT_CITIES_STORAGE_KEY,
  PENDING_CITY_SELECTION_STORAGE_KEY,
  ACCOUNTING_ENTRIES_STORAGE_KEY,
  ACCOUNTING_MONTHLY_BUDGET_STORAGE_KEY,
  ACCOUNTING_HERO_IMAGE_STORAGE_KEY,
  ACCOUNTING_TOTAL_ASSET_STORAGE_KEY,
  NOTES_STORAGE_KEY,
  TODO_ITEMS_STORAGE_KEY,
  PERSONAL_BACKGROUND_IMAGE_STORAGE_KEY,
] as const;

export const KNOWN_STORAGE_KEYS = [
  APP_SETTINGS_STORAGE_KEY,
  LOCAL_BACKUP_STORAGE_KEY,
  RECENT_CITIES_STORAGE_KEY,
  PENDING_CITY_SELECTION_STORAGE_KEY,
  ACCOUNTING_ENTRIES_STORAGE_KEY,
  ACCOUNTING_MONTHLY_BUDGET_STORAGE_KEY,
  ACCOUNTING_HERO_IMAGE_STORAGE_KEY,
  ACCOUNTING_TOTAL_ASSET_STORAGE_KEY,
  NOTES_STORAGE_KEY,
  TODO_ITEMS_STORAGE_KEY,
  PERSONAL_BACKGROUND_IMAGE_STORAGE_KEY,
  AI_ASSISTANT_MESSAGES_STORAGE_KEY,
  AI_ASSISTANT_CONVERSATIONS_STORAGE_KEY,
  AUTH_USER_PROFILE_STORAGE_KEY,
];

/**
 * 判断本地存储键是否属于允许导出和恢复的业务数据。
 *
 * @param key - 统一存储层返回的本地存储键
 * @returns 是否允许进入导出、备份、导入和恢复流程
 * @example
 *   isExportableStorageKey('userToken') // => false
 */
export function isExportableStorageKey(key: string) {
  // [变更] 修改前: 数据管理功能枚举并处理统一存储层中的全部 key
  // [变更] 修改后: 仅允许明确的业务 key 和用户维度 AI 会话 key
  // [原因] 防止 SecureStore 中的登录凭证被导出为明文或通过导入写回
  return EXPORTABLE_STORAGE_KEYS.includes(key as (typeof EXPORTABLE_STORAGE_KEYS)[number])
    || key === AI_ASSISTANT_MESSAGES_STORAGE_KEY
    || key.startsWith(`${AI_ASSISTANT_MESSAGES_STORAGE_KEY}.`)
    || key === AI_ASSISTANT_CONVERSATIONS_STORAGE_KEY
    || key.startsWith(`${AI_ASSISTANT_CONVERSATIONS_STORAGE_KEY}.`);
}
