import { Platform } from 'react-native';

import { AI_ASSISTANT_MESSAGES_STORAGE_KEY } from '@/services/storage-keys';
import { storage } from '@/services/storage';

export type AiAssistantMessageRole = 'assistant' | 'user' | 'system';

export type AiAssistantMessage = {
  id: string;
  role: AiAssistantMessageRole;
  content: string;
  createdAt: string;
};

export type AiScreenKnowledge = {
  route: string;
  summary: string;
};

export type AiModel = {
  id: string;
  label: string;
};

type ChatCompletionResponse = {
  content?: unknown;
  error?: unknown;
};

type ModelsResponse = {
  data?: unknown;
  error?: unknown;
};

export const DEFAULT_AI_MODEL_ID = 'gemini-3.1-pro-preview';

export const AI_ASSISTANT_WELCOME_MESSAGE: AiAssistantMessage = {
  id: 'assistant-welcome',
  role: 'assistant',
  content: '你好，我是 Astesia AI。你可以向我提问，我会结合当前屏幕占位上下文一起回答。',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const DEFAULT_AI_API_HOST = Platform.OS === 'android'
  ? 'http://10.0.2.2:8787'
  : 'http://127.0.0.1:8787';

const AI_API_HOST = (
  process.env.EXPO_PUBLIC_AI_API_HOST?.trim() || DEFAULT_AI_API_HOST
).replace(/\/$/, '');

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

export async function loadAiAssistantMessages() {
  try {
    const rawMessages = await storage.getItem(AI_ASSISTANT_MESSAGES_STORAGE_KEY);

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
  await storage.setItem(AI_ASSISTANT_MESSAGES_STORAGE_KEY, JSON.stringify(messages));
}

export async function clearAiAssistantMessages() {
  await saveAiAssistantMessages([AI_ASSISTANT_WELCOME_MESSAGE]);
  return [AI_ASSISTANT_WELCOME_MESSAGE];
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'AI 服务暂时不可用，请稍后再试。';
}

function isModelItem(value: unknown): value is { id: string } {
  return Boolean(value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string');
}

export async function requestAiModels() {
  try {
    const response = await fetch(`${AI_API_HOST}/api/ai/models`);
    const data = await response.json() as ModelsResponse;

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

    return models.length > 0
      ? models
      : [{ id: DEFAULT_AI_MODEL_ID, label: DEFAULT_AI_MODEL_ID }];
  } catch {
    return [{ id: DEFAULT_AI_MODEL_ID, label: DEFAULT_AI_MODEL_ID }];
  }
}

export async function requestAiAssistantReply(
  messages: AiAssistantMessage[],
  screenKnowledge: AiScreenKnowledge,
  model: string
) {
  try {
    // 格式化: 本地消息列表 → 过滤为模型可理解的 role/content → 后端 chat payload
    // 说明: 避免把前端 id、时间等渲染字段透传给模型
    const response = await fetch(`${AI_API_HOST}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: messages.map(({ role, content }) => ({ role, content })),
        screenKnowledge,
      }),
    });

    const data = await response.json() as ChatCompletionResponse;

    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : 'AI 服务返回异常。');
    }

    if (typeof data.content !== 'string' || !data.content.trim()) {
      throw new Error('AI 服务未返回有效内容。');
    }

    return data.content.trim();
  } catch (error) {
    throw new Error(getErrorMessage(error));
  }
}
