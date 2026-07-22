const DEFAULT_APP_CONTENT_API_HOST = 'https://astesia.cc';
const APP_CONTENT_API_HOST = resolveAppContentApiHost(process.env.EXPO_PUBLIC_AI_API_HOST);

export type AppContentKey = 'updateAnnouncement' | 'help' | 'privacy' | 'about';

export type AppContentBlock = {
  key: AppContentKey;
  title: string;
  content: string;
  updatedBy: string | null;
  updatedAt: string | null;
};

export const APP_CONTENT_KEYS: AppContentKey[] = ['updateAnnouncement', 'help', 'privacy', 'about'];

export const DEFAULT_APP_CONTENT_BLOCKS: Record<AppContentKey, AppContentBlock> = {
  updateAnnouncement: {
    key: 'updateAnnouncement',
    title: '更新公告',
    content: [
      'Astesia 1.0.0',
      '1. 个人页顶部改为用户信息展示模块，并支持邮箱注册和登录。',
      '2. 登录后可展示头像、用户名、所属计划和 AI 剩余额度。',
      '3. 支持主题、字体、首页布局和个人页背景偏好。',
      '4. 新增本地数据导出、导入、备份、恢复和清理入口。',
    ].join('\n'),
    updatedBy: null,
    updatedAt: null,
  },
  help: {
    key: 'help',
    title: '使用帮助',
    content: [
      '使用帮助',
      '1. 笔记入口用于记录灵感、备忘和长文本内容，并可在页面底部切换到待办。',
      '2. 记账用于记录收入、支出和消费备注。',
      '3. 待办用于拆解计划和跟踪完成状态。',
      '4. 个人页顶部会根据登录状态展示用户信息卡，未登录时可通过邮箱注册或登录。',
      '5. 注册使用“用户名 + 邮箱 + 验证码”，注册完成后后续使用“邮箱 + 密码”登录。',
      '6. 笔记、记账和待办数据默认保存在本地，建议定期导出或本地备份，避免换机或卸载带来数据丢失。',
      '7. 设置页的数据导出和本地备份可用于换机前的手动备份。',
    ].join('\n'),
    updatedBy: null,
    updatedAt: null,
  },
  privacy: {
    key: 'privacy',
    title: '隐私说明',
    content: [
      '隐私说明',
      'Astesia 现在支持用户登录，用于识别当前账号、展示所属计划，并校验 AI 对话相关额度。',
      '目前笔记、账单、待办和外观偏好仍默认保存在当前设备本地，不会因为登录自动上传。',
      'AI 对话记录与 AI 计费摘要会按当前登录用户进行隔离，用于保证额度和会话数据不串用。',
      '卸载 App、清空应用数据或手机损坏仍可能导致本地正式数据丢失，请定期导出或备份。',
    ].join('\n\n'),
    updatedBy: null,
    updatedAt: null,
  },
  about: {
    key: 'about',
    title: '关于应用',
    content: [
      'Astesia',
      '一个支持邮箱登录、AI 助手和本地生活管理的笔记、记账、待办 App。',
    ].join('\n\n'),
    updatedBy: null,
    updatedAt: null,
  },
};

/**
 * 读取服务端发布的应用说明内容，并与本地默认文案合并。
 *
 * @returns 四个内容块的完整映射，接口异常时返回默认文案
 * @example
 *   const blocks = await loadAppContentBlocks()
 */
export async function loadAppContentBlocks() {
  try {
    const response = await fetch(`${APP_CONTENT_API_HOST}/api/app/content`);
    const payload = await response.json().catch(() => ({})) as { contents?: unknown };

    if (!response.ok) {
      return DEFAULT_APP_CONTENT_BLOCKS;
    }

    return normalizeAppContentBlocks(payload.contents);
  } catch {
    return DEFAULT_APP_CONTENT_BLOCKS;
  }
}

function normalizeAppContentBlocks(value: unknown) {
  const blocks = { ...DEFAULT_APP_CONTENT_BLOCKS };

  if (!Array.isArray(value)) {
    return blocks;
  }

  for (const item of value) {
    const normalizedBlock = normalizeAppContentBlock(item);

    if (normalizedBlock) {
      blocks[normalizedBlock.key] = normalizedBlock;
    }
  }

  return blocks;
}

function normalizeAppContentBlock(value: unknown): AppContentBlock | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const rawBlock = value as Partial<AppContentBlock>;
  const key = normalizeAppContentKey(rawBlock.key);
  const title = normalizeString(rawBlock.title);
  const content = normalizeString(rawBlock.content);

  if (!key || !title || !content) {
    return null;
  }

  return {
    key,
    title,
    content,
    updatedBy: normalizeString(rawBlock.updatedBy) || null,
    updatedAt: normalizeString(rawBlock.updatedAt) || null,
  };
}

function normalizeAppContentKey(value: unknown): AppContentKey | '' {
  return typeof value === 'string' && APP_CONTENT_KEYS.includes(value as AppContentKey)
    ? value as AppContentKey
    : '';
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveAppContentApiHost(value?: string) {
  const normalizedHost = normalizeApiHost(value);

  if (!normalizedHost) {
    return DEFAULT_APP_CONTENT_API_HOST;
  }

  try {
    const url = new URL(normalizedHost);
    const isLocalHttp = url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '10.0.2.2'].includes(url.hostname);

    if (url.protocol !== 'https:' && !isLocalHttp) {
      return DEFAULT_APP_CONTENT_API_HOST;
    }

    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return DEFAULT_APP_CONTENT_API_HOST;
  }
}

function normalizeApiHost(value?: string) {
  return typeof value === 'string'
    ? value.trim().replace(/[`'"]/g, '').replace(/\/+$/, '')
    : '';
}
