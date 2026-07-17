import {
  AI_ASSISTANT_CONVERSATIONS_STORAGE_KEY,
  AI_ASSISTANT_MESSAGES_STORAGE_KEY,
} from '@/services/storage-keys';
import { storage } from '@/services/storage';
import { userStore } from '@/services/store/userStore';

export type AiAssistantMessageRole = 'assistant' | 'user' | 'system';

export type AiAssistantMessage = {
  id: string;
  role: AiAssistantMessageRole;
  content: string;
  createdAt: string;
};

export type AiAssistantConversation = {
  id: string;
  title: string;
  messages: AiAssistantMessage[];
  createdAt: string;
  updatedAt: string;
  titleGeneratedAt?: string;
};

export type AiScreenKnowledge = {
  route: string;
  summary: string;
};

export type AiModel = {
  id: string;
  label: string;
};

export type AiModelsResult = {
  models: AiModel[];
  errorMessage: string | null;
};

type ChatCompletionResponse = {
  content?: unknown;
  error?: unknown;
};

type ModelsResponse = {
  data?: unknown;
  error?: unknown;
};

type ConversationsResponse = {
  conversations?: unknown;
  conversation?: unknown;
  error?: unknown;
};

type ConversationTitleResponse = {
  title?: unknown;
  error?: unknown;
};

type AiBillingMetrics = {
  totalCostUsd?: unknown;
  remainingBalanceUsd?: unknown;
  totalChargedUsd?: unknown;
};

type AiUsageMetrics = {
  promptTokens?: unknown;
  cachedPromptTokens?: unknown;
  completionTokens?: unknown;
  reasoningTokens?: unknown;
  totalTokens?: unknown;
};

type AiStreamEvent =
  | {
      event: 'chunk';
      data: { content?: unknown };
    }
  | {
      event: 'done';
      data: {
        requestId?: unknown;
        providerRequestId?: unknown;
        usage?: AiUsageMetrics;
        billing?: AiBillingMetrics;
      };
    }
  | {
      event: 'error';
      data: { message?: unknown };
    };

export type AiAssistantReplyStreamOptions = {
  signal?: AbortSignal;
  onChunk?: (chunk: string, fullContent: string) => void;
  conversationId?: string;
};

export const DEFAULT_AI_MODEL_ID = 'gemini-3.1-pro-preview';
export const DEFAULT_AI_CONVERSATION_TITLE = '对话标题';
export const MAX_AI_CONVERSATION_TITLE_LENGTH = 12;

export const AI_ASSISTANT_WELCOME_MESSAGE: AiAssistantMessage = {
  id: 'assistant-welcome',
  role: 'assistant',
  content: '你好，我是 Astesia AI。你可以向我提问，也可以按需把当前屏幕知识加入对话。',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const DEFAULT_AI_API_HOST = 'https://astesia.cc';

const AI_API_HOST = resolveAiApiHost(process.env.EXPO_PUBLIC_AI_API_HOST);
const AI_USER_TOKEN_STORAGE_KEY = 'userToken';
const AI_USER_ID_STORAGE_KEY = 'userId';
const AI_USER_ID_HEADER = 'X-AI-User-Id';

/**
 * 创建 AI 对话消息，统一补齐 id 与创建时间。
 *
 * @param role - 消息角色
 * @param content - 消息正文
 * @returns 可存储和渲染的 AI 消息
 * @example
 *   createAiAssistantMessage('user', '帮我总结当前页面')
 */
export function createAiAssistantMessage(
  role: AiAssistantMessageRole,
  content: string
): AiAssistantMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 创建一轮 AI 会话，统一补齐会话 id、标题和时间字段。
 *
 * @param messages - 会话内消息，默认仅包含欢迎语
 * @param title - 会话标题，默认使用待总结占位标题
 * @returns 可本地缓存并远端保存的 AI 会话
 * @example
 *   createAiAssistantConversation()
 */
export function createAiAssistantConversation(
  messages: AiAssistantMessage[] = [AI_ASSISTANT_WELCOME_MESSAGE],
  title = DEFAULT_AI_CONVERSATION_TITLE
): AiAssistantConversation {
  const now = new Date().toISOString();

  return {
    id: `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    messages,
    createdAt: now,
    updatedAt: now,
  };
}

function isAssistantMessage(value: unknown): value is AiAssistantMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const message = value as Partial<AiAssistantMessage>;
  return (
    typeof message.id === 'string'
    && typeof message.content === 'string'
    && typeof message.createdAt === 'string'
    && (message.role === 'assistant' || message.role === 'user' || message.role === 'system')
  );
}

function isAssistantConversation(value: unknown): value is AiAssistantConversation {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const conversation = value as Partial<AiAssistantConversation>;
  return (
    typeof conversation.id === 'string'
    && typeof conversation.title === 'string'
    && typeof conversation.createdAt === 'string'
    && typeof conversation.updatedAt === 'string'
    && Array.isArray(conversation.messages)
  );
}

export async function loadAiAssistantMessages() {
  try {
    const storageKey = await getAiAssistantMessagesStorageKey();
    const rawMessages = await readAiStorageValueWithLegacyFallback(
      storageKey,
      AI_ASSISTANT_MESSAGES_STORAGE_KEY
    );

    if (!rawMessages) {
      return [AI_ASSISTANT_WELCOME_MESSAGE];
    }

    const parsedMessages = JSON.parse(rawMessages);
    return Array.isArray(parsedMessages)
      ? parsedMessages.filter(isAssistantMessage)
      : [AI_ASSISTANT_WELCOME_MESSAGE];
  } catch {
    return [AI_ASSISTANT_WELCOME_MESSAGE];
  }
}

export async function saveAiAssistantMessages(messages: AiAssistantMessage[]) {
  const storageKey = await getAiAssistantMessagesStorageKey();
  await storage.setItem(storageKey, JSON.stringify(messages));
}

export async function clearAiAssistantMessages() {
  await saveAiAssistantMessages([AI_ASSISTANT_WELCOME_MESSAGE]);
  return [AI_ASSISTANT_WELCOME_MESSAGE];
}

export async function loadAiAssistantConversations() {
  const localConversations = await loadLocalAiAssistantConversations();
  const requestHeaders = await createAiRequestHeaders();

  try {
    const response = await fetch(`${AI_API_HOST}/api/ai/conversations`, {
      headers: requestHeaders,
    });
    const data = await response.json().catch(() => ({})) as ConversationsResponse;

    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : '多轮对话列表获取失败。');
    }

    // 格式化: 远端会话列表 + 本地缓存列表 → 以 updatedAt 较新的记录合并 → 最新会话优先展示
    // 说明: 远端失败时仍保留本地可用数据，远端成功时补齐本地离线期间保存的会话
    const remoteConversations = normalizeConversationList(data.conversations);
    const mergedConversations = mergeAiConversations(remoteConversations, localConversations);

    if (mergedConversations.length > 0) {
      await saveLocalAiAssistantConversations(mergedConversations);
    }

    return mergedConversations;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.warn(`[AI] 多轮对话列表加载失败: ${errorMessage}; 使用本地缓存`);
    return localConversations;
  }
}

export async function saveAiAssistantConversation(conversation: AiAssistantConversation) {
  const normalizedConversation = normalizeConversation(conversation);
  const localConversations = await loadLocalAiAssistantConversations();
  const nextLocalConversations = mergeAiConversations([normalizedConversation], localConversations);
  const requestHeaders = await createAiJsonRequestHeaders();

  await saveLocalAiAssistantConversations(nextLocalConversations);

  try {
    const response = await fetch(`${AI_API_HOST}/api/ai/conversations/${encodeURIComponent(normalizedConversation.id)}`, {
      method: 'PUT',
      headers: requestHeaders,
      body: JSON.stringify({ conversation: normalizedConversation }),
    });
    const data = await response.json().catch(() => ({})) as ConversationsResponse;

    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : '多轮对话远端保存失败。');
    }

    const remoteConversation = isAssistantConversation(data.conversation)
      ? normalizeConversation(data.conversation)
      : normalizedConversation;
    await saveLocalAiAssistantConversations(mergeAiConversations([remoteConversation], nextLocalConversations));

    return {
      conversation: remoteConversation,
      remoteSaved: true,
      errorMessage: null,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.warn(`[AI] 多轮对话远端保存失败: ${errorMessage}; 已保存在本地缓存`);

    return {
      conversation: normalizedConversation,
      remoteSaved: false,
      errorMessage,
    };
  }
}

export async function deleteAiAssistantConversation(conversationId: string) {
  const localConversations = await loadLocalAiAssistantConversations();
  const requestHeaders = await createAiRequestHeaders();
  await saveLocalAiAssistantConversations(
    localConversations.filter((conversation) => conversation.id !== conversationId)
  );

  try {
    const response = await fetch(`${AI_API_HOST}/api/ai/conversations/${encodeURIComponent(conversationId)}`, {
      method: 'DELETE',
      headers: requestHeaders,
    });
    const data = await response.json().catch(() => ({})) as ConversationsResponse;

    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : '多轮对话远端删除失败。');
    }

    return { remoteDeleted: true, errorMessage: null };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.warn(`[AI] 多轮对话远端删除失败: ${errorMessage}; 本地缓存已删除`);
    return { remoteDeleted: false, errorMessage };
  }
}

export async function requestAiConversationTitle(messages: AiAssistantMessage[]) {
  const titleMessages = messages
    .filter(isAssistantMessage)
    .filter((message) => message.content.trim().length > 0)
    .map(({ role, content }) => ({ role, content }));
  const requestHeaders = await createAiJsonRequestHeaders();

  if (titleMessages.length === 0) {
    return DEFAULT_AI_CONVERSATION_TITLE;
  }

  const response = await fetch(`${AI_API_HOST}/api/ai/conversations/summarize-title`, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify({ messages: titleMessages }),
  });
  const data = await response.json().catch(() => ({})) as ConversationTitleResponse;

  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : '对话标题总结失败。');
  }

  return normalizeAiConversationTitle(data.title);
}

export function isDefaultAiConversationTitle(title: string) {
  return !title.trim() || title.trim() === DEFAULT_AI_CONVERSATION_TITLE;
}

function normalizeConversationList(value: unknown) {
  return Array.isArray(value)
    ? value.filter(isAssistantConversation).map(normalizeConversation).sort(compareConversationsByUpdatedAt)
    : [];
}

function normalizeConversation(value: AiAssistantConversation): AiAssistantConversation {
  const messages = Array.isArray(value.messages)
    ? value.messages.filter(isAssistantMessage)
    : [AI_ASSISTANT_WELCOME_MESSAGE];

  return {
    ...value,
    title: normalizeAiConversationTitle(value.title),
    messages: messages.length > 0 ? messages : [AI_ASSISTANT_WELCOME_MESSAGE],
    createdAt: normalizeIsoString(value.createdAt),
    updatedAt: normalizeIsoString(value.updatedAt),
    titleGeneratedAt: typeof value.titleGeneratedAt === 'string' ? value.titleGeneratedAt : undefined,
  };
}

/**
 * 规范化 AI 对话标题，统一处理空值、引号、空白字符和长度上限。
 *
 * @param value - 原始标题文本，可来自接口响应或用户手动输入
 * @returns 可直接展示和持久化的标题文本
 * @example
 *   normalizeAiConversationTitle('“Git 强制 推送”')
 */
export function normalizeAiConversationTitle(value: unknown) {
  if (typeof value !== 'string') {
    return DEFAULT_AI_CONVERSATION_TITLE;
  }

  const normalizedTitle = value
    .replace(/["'“”‘’《》「」]/g, '')
    .replace(/\s+/g, '')
    .trim();

  if (!normalizedTitle) {
    return DEFAULT_AI_CONVERSATION_TITLE;
  }

  return Array.from(normalizedTitle).slice(0, MAX_AI_CONVERSATION_TITLE_LENGTH).join('');
}

function normalizeIsoString(value: unknown) {
  if (typeof value !== 'string') {
    return new Date().toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function mergeAiConversations(...conversationGroups: AiAssistantConversation[][]) {
  const conversationMap = new Map<string, AiAssistantConversation>();

  for (const conversation of conversationGroups.flat()) {
    const normalizedConversation = normalizeConversation(conversation);
    const storedConversation = conversationMap.get(normalizedConversation.id);

    if (
      !storedConversation
      || new Date(normalizedConversation.updatedAt).getTime() >= new Date(storedConversation.updatedAt).getTime()
    ) {
      conversationMap.set(normalizedConversation.id, normalizedConversation);
    }
  }

  return Array.from(conversationMap.values()).sort(compareConversationsByUpdatedAt);
}

function compareConversationsByUpdatedAt(
  currentConversation: AiAssistantConversation,
  nextConversation: AiAssistantConversation
) {
  return new Date(nextConversation.updatedAt).getTime() - new Date(currentConversation.updatedAt).getTime();
}

async function loadLocalAiAssistantConversations() {
  try {
    const storageKey = await getAiAssistantConversationsStorageKey();
    const rawConversations = await readAiStorageValueWithLegacyFallback(
      storageKey,
      AI_ASSISTANT_CONVERSATIONS_STORAGE_KEY
    );

    if (rawConversations) {
      const parsedConversations = JSON.parse(rawConversations);
      const conversations = normalizeConversationList(parsedConversations);

      if (conversations.length > 0) {
        return conversations;
      }
    }

    const legacyMessages = await loadAiAssistantMessages();

    if (legacyMessages.length > 1) {
      const legacyConversation = createAiAssistantConversation(legacyMessages);
      await saveLocalAiAssistantConversations([legacyConversation]);
      return [legacyConversation];
    }

    return [];
  } catch {
    return [];
  }
}

async function saveLocalAiAssistantConversations(conversations: AiAssistantConversation[]) {
  const storageKey = await getAiAssistantConversationsStorageKey();
  await storage.setItem(
    storageKey,
    JSON.stringify(mergeAiConversations(conversations))
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'AI 服务暂时不可用，请稍后再试。';
}

async function resolveAiUserContext() {
  // [变更] 修改前: AI 服务请求不感知当前用户，本地缓存和远端读写都按全局单桶处理
  // [变更] 修改后: 用户信息优先取自 userStore，身份凭证仅从统一安全存储层读取
  // [原因] AI 对话需按用户隔离结算，且不能从 AsyncStorage 回退读取明文 token
  const [storedUserId, storedUserToken] = await Promise.all([
    storage.getItem(AI_USER_ID_STORAGE_KEY),
    storage.getItem(AI_USER_TOKEN_STORAGE_KEY),
  ]);
  const storeUser = userStore.getUser();
  const normalizedUserId = normalizeAiUserIdCandidate(
    storeUser?.userId ?? storedUserId ?? null
  );
  const authorizationToken = normalizeAuthorizationToken(storedUserToken);

  return {
    userId: normalizedUserId,
    authorizationToken,
  };
}

async function createAiRequestHeaders(initHeaders?: HeadersInit) {
  const requestHeaders = new Headers(initHeaders);
  const aiUserContext = await resolveAiUserContext();

  if (aiUserContext.authorizationToken) {
    requestHeaders.set('Authorization', `Bearer ${aiUserContext.authorizationToken}`);
  }

  if (aiUserContext.userId) {
    requestHeaders.set(AI_USER_ID_HEADER, aiUserContext.userId);
  }

  return requestHeaders;
}

async function createAiJsonRequestHeaders(initHeaders?: HeadersInit) {
  const requestHeaders = await createAiRequestHeaders(initHeaders);
  requestHeaders.set('Content-Type', 'application/json');
  return requestHeaders;
}

async function getAiAssistantConversationsStorageKey() {
  const aiUserContext = await resolveAiUserContext();

  return aiUserContext.userId
    ? `${AI_ASSISTANT_CONVERSATIONS_STORAGE_KEY}:${aiUserContext.userId}`
    : AI_ASSISTANT_CONVERSATIONS_STORAGE_KEY;
}

async function getAiAssistantMessagesStorageKey() {
  const aiUserContext = await resolveAiUserContext();

  return aiUserContext.userId
    ? `${AI_ASSISTANT_MESSAGES_STORAGE_KEY}:${aiUserContext.userId}`
    : AI_ASSISTANT_MESSAGES_STORAGE_KEY;
}

async function readAiStorageValueWithLegacyFallback(primaryKey: string, legacyKey: string) {
  const primaryValue = await storage.getItem(primaryKey);

  if (primaryValue || primaryKey === legacyKey) {
    return primaryValue;
  }

  return storage.getItem(legacyKey);
}

function normalizeAiUserIdCandidate(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  if (typeof value !== 'string') {
    return '';
  }

  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : '';
}

function normalizeAuthorizationToken(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalizedValue = value.trim();
  return normalizedValue.replace(/^Bearer\s+/i, '');
}

function normalizeApiHost(value?: string) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/[`'"]/g, '').replace(/\/+$/, '');
}

function resolveAiApiHost(value?: string) {
  const normalizedHost = normalizeApiHost(value);

  // [变更] 修改前: 缺省或 Android 本地调试地址会请求 10.0.2.2 / 127.0.0.1
  // [变更] 修改后: 缺省值和本地调试地址统一落到真实后端域名
  // [原因] 当前所有 AI 后端请求都必须走线上服务，避免本地 8787 未启动导致功能失败
  if (!normalizedHost || isLocalDebugApiHost(normalizedHost)) {
    return DEFAULT_AI_API_HOST;
  }

  return normalizedHost;
}

function isLocalDebugApiHost(value: string) {
  return /^https?:\/\/(10\.0\.2\.2|127\.0\.0\.1|localhost)(:\d+)?$/i.test(value);
}

function isModelItem(value: unknown): value is { id: string } {
  return Boolean(value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string');
}

export async function requestAiModels() {
  try {
    const response = await fetch(`${AI_API_HOST}/api/ai/models`);
    const data = await response.json().catch(() => ({})) as ModelsResponse;

    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : '模型列表获取失败。');
    }

    // 格式化: OpenAI 兼容模型数组 → 过滤有效 id 并生成 label → 模型选择列表
    // 说明: 让前端选择器只依赖稳定的模型 id，不绑定上游完整响应结构
    const models = Array.isArray(data.data)
      ? data.data.filter(isModelItem).map((model) => ({
          id: model.id,
          label: model.id,
        }))
      : [];

    return {
      models: models.length > 0
        ? models
        : [{ id: DEFAULT_AI_MODEL_ID, label: DEFAULT_AI_MODEL_ID }],
      errorMessage: models.length > 0 ? null : '模型接口返回为空，当前回退到默认模型。',
    } satisfies AiModelsResult;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.warn(`[AI] 模型列表加载失败: ${errorMessage}; host=${AI_API_HOST}`);

    return {
      models: [{ id: DEFAULT_AI_MODEL_ID, label: DEFAULT_AI_MODEL_ID }],
      errorMessage,
    } satisfies AiModelsResult;
  }
}

export async function requestAiAssistantReply(
  messages: AiAssistantMessage[],
  screenKnowledge: AiScreenKnowledge | null,
  model: string,
  options?: AiAssistantReplyStreamOptions
) {
  const requestHeaders = await createAiJsonRequestHeaders({
    Accept: 'text/event-stream',
  });

  // [变更] 修改前: 每次请求都会无条件透传 screenKnowledge
  // [变更] 修改后: 除了按需透传 screenKnowledge，还会把当前 conversationId 一起发给服务端
  // [原因] 服务端需要基于会话维度归档 usage 和扣费记录，避免多轮对话的计费明细丢失上下文
  const requestBody = JSON.stringify({
    model,
    ...(options?.conversationId ? { conversationId: options.conversationId } : {}),
    messages: messages.map(({ role, content }) => ({ role, content })),
    ...(screenKnowledge ? { screenKnowledge } : {}),
  });

  try {
    // 格式化: 本地消息列表 → 过滤为模型可理解的 role/content → 后端 chat payload
    // 说明: 避免把前端 id、时间等渲染字段透传给模型，并优先使用原生流式能力消费 SSE
    const response = await fetch(`${AI_API_HOST}/api/ai/chat`, {
      method: 'POST',
        headers: requestHeaders,
      signal: options?.signal,
      body: requestBody,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as ChatCompletionResponse;
      throw new Error(typeof data.error === 'string' ? data.error : 'AI 服务返回异常。');
    }

    const reader = response.body?.getReader();

    if (!reader) {
      // [变更] 修改前: 原生端没有 ReadableStream 时直接报错退出
      // [变更] 修改后: 回退到 XMLHttpRequest 的增量 responseText，继续解析 SSE
      // [原因] Expo / React Native 环境通常不支持 fetch.getReader，但仍支持通过 XHR 实现流式输出
        return requestAiAssistantReplyWithXhr(requestBody, requestHeaders, options);
    }

    return consumeAssistantReplyReader(reader, options);
  } catch (error) {
    if (error instanceof Error && error.message === '当前环境不支持 AI 流式返回。') {
      return requestAiAssistantReplyWithXhr(requestBody, requestHeaders, options);
    }

    throw new Error(getErrorMessage(error));
  }
}

/**
 * 使用 ReadableStream 消费 SSE 响应，并在每次收到文本分片时回调 UI。
 *
 * @param reader - fetch 返回的可读流 reader
 * @param options - 流式输出回调与取消信号
 * @returns 完整的 AI 回复文本
 * @example
 *   consumeAssistantReplyReader(reader, { onChunk: (_, full) => console.log(full) })
 */
async function consumeAssistantReplyReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options?: AiAssistantReplyStreamOptions
) {
  let fullContent = '';
  let sseBuffer = '';
  const decoder = new TextDecoder();

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    sseBuffer += decoder.decode(value, { stream: true });
    const parsedEvents = consumeSseEvents(sseBuffer);
    sseBuffer = parsedEvents.rest;

    fullContent = applyStreamEvents(parsedEvents.events, fullContent, options);
  }

  sseBuffer += decoder.decode();
  const finalEvents = consumeSseEvents(`${sseBuffer}\n\n`);
  fullContent = applyStreamEvents(finalEvents.events, fullContent, options);

  if (!fullContent.trim()) {
    throw new Error('AI 服务未返回有效内容。');
  }

  return fullContent.trim();
}

/**
 * 在 React Native 原生端使用 XMLHttpRequest 读取逐步增长的 responseText，并按 SSE 协议解析。
 *
 * @param requestBody - 已序列化的 chat 请求体
 * @param options - 流式输出回调与取消信号
 * @returns 完整的 AI 回复文本
 * @example
 *   requestAiAssistantReplyWithXhr(body, { onChunk: (_, full) => console.log(full) })
 */
function requestAiAssistantReplyWithXhr(
  requestBody: string,
  requestHeaders: Headers,
  options?: AiAssistantReplyStreamOptions
) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let isSettled = false;
    let fullContent = '';
    let sseBuffer = '';
    let processedLength = 0;

    const finalize = (handler: () => void) => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      options?.signal?.removeEventListener('abort', handleAbort);
      handler();
    };

    const consumeResponseText = (forceFlush = false) => {
      const nextText = xhr.responseText.slice(processedLength);

      if (!nextText && !forceFlush) {
        return;
      }

      processedLength = xhr.responseText.length;
      sseBuffer += nextText;
      const parsedEvents = consumeSseEvents(forceFlush ? `${sseBuffer}\n\n` : sseBuffer);
      sseBuffer = parsedEvents.rest;
      fullContent = applyStreamEvents(parsedEvents.events, fullContent, options);
    };

    const handleAbort = () => {
      xhr.abort();
      finalize(() => reject(new Error('AI 请求已取消。')));
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState === xhr.LOADING) {
        consumeResponseText();
        return;
      }

      if (xhr.readyState !== xhr.DONE) {
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          consumeResponseText(true);

          if (!fullContent.trim()) {
            throw new Error('AI 服务未返回有效内容。');
          }

          finalize(() => resolve(fullContent.trim()));
        } catch (error) {
          finalize(() => reject(new Error(getErrorMessage(error))));
        }

        return;
      }

      let errorMessage = 'AI 服务返回异常。';

      try {
        const data = JSON.parse(xhr.responseText) as ChatCompletionResponse;
        errorMessage = typeof data.error === 'string' ? data.error : errorMessage;
      } catch {
        if (xhr.responseText.trim()) {
          errorMessage = xhr.responseText.trim();
        }
      }

      finalize(() => reject(new Error(errorMessage)));
    };

    xhr.onerror = () => {
      finalize(() => reject(new Error('AI 服务网络请求失败。')));
    };

    xhr.open('POST', `${AI_API_HOST}/api/ai/chat`);
      requestHeaders.forEach((headerValue, headerKey) => {
        xhr.setRequestHeader(headerKey, headerValue);
      });

    if (options?.signal) {
      options.signal.addEventListener('abort', handleAbort);
    }

    xhr.send(requestBody);
  });
}

function applyStreamEvents(
  events: AiStreamEvent[],
  currentContent: string,
  options?: AiAssistantReplyStreamOptions
) {
  let nextContent = currentContent;

  for (const event of events) {
    if (event.event === 'chunk') {
      const chunk = normalizeStreamChunk(event.data.content);

      if (!chunk) {
        continue;
      }

      nextContent += chunk;
      options?.onChunk?.(chunk, nextContent);
      continue;
    }

    if (event.event === 'error') {
      throw new Error(
        typeof event.data.message === 'string' && event.data.message.trim()
          ? event.data.message
          : 'AI 服务返回异常。'
      );
    }
  }

  return nextContent;
}

/**
 * 解析 SSE 文本缓冲区，拆出完整事件并保留未结束的尾部片段。
 *
 * @param buffer - 原始 SSE 文本缓冲区
 * @returns 已解析的事件列表和剩余缓冲区
 * @example
 *   consumeSseEvents('event: chunk\ndata: {"content":"你好"}\n\n')
 */
function consumeSseEvents(buffer: string) {
  const normalizedBuffer = buffer.replace(/\r\n/g, '\n');
  const rawEvents = normalizedBuffer.split('\n\n');
  const rest = rawEvents.pop() ?? '';
  const events = rawEvents
    .map(parseSseEvent)
    .filter((event): event is AiStreamEvent => event !== null);

  return { events, rest };
}

function parseSseEvent(block: string): AiStreamEvent | null {
  const lines = block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  let eventName = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith(':')) {
      continue;
    }

    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  try {
    const data = JSON.parse(dataLines.join('\n')) as AiStreamEvent['data'];

    if (eventName === 'chunk' || eventName === 'done' || eventName === 'error') {
      return {
        event: eventName,
        data,
      } as AiStreamEvent;
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeStreamChunk(content: unknown) {
  return typeof content === 'string' ? content : '';
}
