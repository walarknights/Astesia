import { existsSync, readFileSync } from 'node:fs';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import pg from 'pg';

loadLocalEnv();

const NITRO_ROUTER_URL = 'https://api.nitrorouter.com/v1/chat/completions';
const NITRO_ROUTER_MODELS_URL = 'https://api.nitrorouter.com/v1/models';
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEEPSEEK_URL = `${DEEPSEEK_BASE_URL}/chat/completions`;
const DEEPSEEK_MODELS_URL = `${DEEPSEEK_BASE_URL}/models`;
const DEEPSEEK_MODEL_PREFIX = 'deepseek-';
const DEFAULT_MODEL = 'gemini-3.1-pro-preview';
const DEFAULT_DEEPSEEK_TITLE_MODEL = 'deepseek-v4-flash';
const DEFAULT_CONVERSATION_TITLE = '对话标题';
const PORT = Number(getEnvValue('AI_SERVER_PORT') || 8787);
const { Pool } = pg;

const app = new Hono();
let databasePool = null;

app.use('*', cors());

app.get('/health', (c) => c.json({ ok: true }));

app.get('/api/ai/models', async (c) => {
  const [deepseekModels, nitroModels] = await Promise.all([
    fetchCompatibleModels({
      apiKey: getEnvValue('DEEPSEEK_API_KEY'),
      apiKeyName: 'DEEPSEEK_API_KEY',
      modelsUrl: DEEPSEEK_MODELS_URL,
      providerName: 'DeepSeek',
    }),
    fetchCompatibleModels({
      apiKey: getEnvValue('NITRO_ROUTER_API_KEY'),
      apiKeyName: 'NITRO_ROUTER_API_KEY',
      modelsUrl: NITRO_ROUTER_MODELS_URL,
      providerName: 'Nitro Router',
    }),
  ]);
  const models = mergeModelItems(
    appendDocumentedDeepSeekModels(deepseekModels),
    nitroModels
  );

  if (models.length === 0) {
    return c.json({ error: '缺少可用模型配置，请至少配置 DEEPSEEK_API_KEY 或 NITRO_ROUTER_API_KEY。' }, 500);
  }

  return c.json({ data: models });
});

app.get('/api/ai/conversations', async (c) => {
  try {
    return c.json({ conversations: await readConversations() });
  } catch (error) {
    return c.json({ error: getRuntimeErrorMessage(error) }, 500);
  }
});

app.put('/api/ai/conversations/:id', async (c) => {
  const body = await c.req.json().catch(() => null);
  const conversation = normalizeConversationPayload(body?.conversation);
  const routeConversationId = c.req.param('id');

  if (!conversation) {
    return c.json({ error: '缺少有效的多轮对话数据。' }, 400);
  }

  if (conversation.id !== routeConversationId) {
    return c.json({ error: '多轮对话 id 不一致。' }, 400);
  }

  try {
    return c.json({ conversation: await upsertConversation(conversation) });
  } catch (error) {
    return c.json({ error: getRuntimeErrorMessage(error) }, 500);
  }
});

app.delete('/api/ai/conversations/:id', async (c) => {
  const conversationId = c.req.param('id');

  try {
    await deleteConversation(conversationId);
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ error: getRuntimeErrorMessage(error) }, 500);
  }
});

app.post('/api/ai/conversations/summarize-title', async (c) => {
  const apiKey = getEnvValue('DEEPSEEK_API_KEY');

  if (!apiKey) {
    return c.json({ error: '缺少 DEEPSEEK_API_KEY，请先在后端环境变量中配置。' }, 500);
  }

  const body = await c.req.json().catch(() => null);
  const messages = Array.isArray(body?.messages)
    ? body.messages.filter(isChatMessage)
    : [];

  if (messages.length === 0) {
    return c.json({ error: '缺少可用于总结标题的对话内容。' }, 400);
  }

  const conversationText = buildConversationTitleContext(messages);
  // [变更] 修改前: 标题总结复用 Nitro Router 模型，模型渠道不可用时会直接失败
  // [变更] 修改后: 标题总结固定走 DeepSeek，并默认使用 deepseek-v4-flash
  // [原因] 用户明确要求标题总结统一走 DeepSeek Flash，且该场景更适合低延迟摘要模型
  const upstreamResponse = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getDeepSeekTitleModel(),
      stream: false,
      messages: [
        {
          role: 'system',
          content: [
            '你是移动端 AI 对话标题生成器。',
            '请只输出一个中文短标题，不要解释，不要标点，不要引号。',
            '标题必须 12 个字以内，准确概括用户意图。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `请为下面这段对话生成标题：\n${conversationText}`,
        },
      ],
    }),
    signal: c.req.raw.signal,
  });
  const upstreamData = await upstreamResponse.json().catch(() => null);

  if (!upstreamResponse.ok) {
    return c.json({
      error: getUpstreamError(upstreamData) || '对话标题总结失败。',
    }, upstreamResponse.status);
  }

  return c.json({ title: sanitizeConversationTitle(extractCompletionText(upstreamData)) });
});

app.post('/api/ai/chat', async (c) => {
  const body = await c.req.json().catch(() => null);
  const userMessages = Array.isArray(body?.messages)
    ? body.messages.filter(isChatMessage)
    : [];
  const screenKnowledge = normalizeScreenKnowledge(body?.screenKnowledge);
  const model = normalizeModel(body?.model);
  const chatUpstream = resolveChatUpstream(model);

  if (userMessages.length === 0) {
    return c.json({ error: '缺少可发送给 AI 的对话消息。' }, 400);
  }

  if (!chatUpstream.apiKey) {
    return c.json({ error: `缺少 ${chatUpstream.apiKeyName}，请先在后端环境变量中配置。` }, 500);
  }

  const upstreamResponse = await fetch(chatUpstream.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${chatUpstream.apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        {
          role: 'system',
          content: [
            '你是 Astesia App 内的移动端 AI 助手。',
            '回答需要简洁、友好，并优先结合当前屏幕知识库。',
            `当前屏幕知识库：${screenKnowledge}`,
          ].join('\n'),
        },
        ...userMessages,
      ],
    }),
    signal: c.req.raw.signal,
  });

  if (!upstreamResponse.ok) {
    const upstreamData = await upstreamResponse.json().catch(() => null);

    return c.json({
      error: getUpstreamError(upstreamData) || 'AI 上游服务返回异常。',
    }, upstreamResponse.status);
  }

  const upstreamReader = upstreamResponse.body?.getReader();

  if (!upstreamReader) {
    return c.json({ error: 'AI 上游服务未提供可读取的流式响应。' }, 502);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let buffer = '';
  let hasStreamedContent = false;

  const stream = new ReadableStream({
    async start(controller) {
      const emitEvent = (eventName, data) => {
        controller.enqueue(encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        while (true) {
          const { value, done } = await upstreamReader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const parsed = consumeSsePayload(buffer);
          buffer = parsed.rest;

          for (const payload of parsed.events) {
            if (payload === '[DONE]') {
              continue;
            }

            const chunk = extractStreamText(payload);

            if (!chunk) {
              continue;
            }

            hasStreamedContent = true;
            emitEvent('chunk', { content: chunk });
          }
        }

        buffer += decoder.decode();
        const parsed = consumeSsePayload(`${buffer}\n\n`);

        for (const payload of parsed.events) {
          if (payload === '[DONE]') {
            continue;
          }

          const chunk = extractStreamText(payload);

          if (!chunk) {
            continue;
          }

          hasStreamedContent = true;
          emitEvent('chunk', { content: chunk });
        }

        if (!hasStreamedContent) {
          emitEvent('error', { message: 'AI 上游服务未返回有效内容。' });
          controller.close();
          return;
        }

        emitEvent('done', {});
        controller.close();
      } catch (error) {
        emitEvent('error', { message: getRuntimeErrorMessage(error) });
        controller.close();
      } finally {
        upstreamReader.releaseLock();
      }
    },
    async cancel() {
      await upstreamReader.cancel().catch(() => null);
    },
  });

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    },
  });
});

function getDatabasePool() {
  const databaseUrl = normalizeDatabaseUrl(getEnvValue('DATABASE_URL'));

  if (!databaseUrl) {
    throw new Error('缺少 DATABASE_URL，请先配置 PostgreSQL 连接串。');
  }

  if (!databasePool) {
    databasePool = new Pool({
      connectionString: databaseUrl,
      ssl: shouldUseDatabaseSsl(databaseUrl) ? { rejectUnauthorized: false } : undefined,
    });
  }

  return databasePool;
}

function normalizeDatabaseUrl(value) {
  return typeof value === 'string'
    ? value.trim().replace(/^['"]|['"]$/g, '')
    : '';
}

function shouldUseDatabaseSsl(databaseUrl) {
  if (getEnvValue('DATABASE_SSL') === 'true') {
    return true;
  }

  if (getEnvValue('DATABASE_SSL') === 'false') {
    return false;
  }

  return !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(databaseUrl);
}

async function readConversations() {
  const pool = getDatabasePool();
  const { rows } = await pool.query(`
    SELECT id, title, messages, created_at, updated_at, title_generated_at
    FROM ai_conversations
    ORDER BY updated_at DESC
  `);

  return rows.map(normalizeConversationRow).filter(Boolean);
}

async function upsertConversation(conversation) {
  const pool = getDatabasePool();
  const { rows } = await pool.query(`
    INSERT INTO ai_conversations (
      id,
      title,
      messages,
      created_at,
      updated_at,
      title_generated_at
    )
    VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6::timestamptz)
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      messages = EXCLUDED.messages,
      created_at = LEAST(ai_conversations.created_at, EXCLUDED.created_at),
      updated_at = EXCLUDED.updated_at,
      title_generated_at = EXCLUDED.title_generated_at
    WHERE EXCLUDED.updated_at >= ai_conversations.updated_at
    RETURNING id, title, messages, created_at, updated_at, title_generated_at
  `, [
    conversation.id,
    conversation.title,
    JSON.stringify(conversation.messages),
    conversation.createdAt,
    conversation.updatedAt,
    conversation.titleGeneratedAt ?? null,
  ]);

  if (rows[0]) {
    return normalizeConversationRow(rows[0]) ?? conversation;
  }

  const existingConversation = await readConversationById(conversation.id);
  return existingConversation ?? conversation;
}

async function readConversationById(conversationId) {
  const pool = getDatabasePool();
  const { rows } = await pool.query(`
    SELECT id, title, messages, created_at, updated_at, title_generated_at
    FROM ai_conversations
    WHERE id = $1
  `, [conversationId]);

  return rows[0] ? normalizeConversationRow(rows[0]) : null;
}

async function deleteConversation(conversationId) {
  const pool = getDatabasePool();
  await pool.query('DELETE FROM ai_conversations WHERE id = $1', [conversationId]);
}

function normalizeConversationRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  return normalizeConversationPayload({
    id: row.id,
    title: row.title,
    messages: row.messages,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    titleGeneratedAt: row.title_generated_at,
  });
}

function normalizeConversationPayload(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const messages = Array.isArray(value.messages)
    ? value.messages.filter(isStoredMessage)
    : [];

  if (
    typeof value.id !== 'string'
    || typeof value.title !== 'string'
    || messages.length === 0
  ) {
    return null;
  }

  const now = new Date().toISOString();

  return {
    id: value.id,
    title: sanitizeConversationTitle(value.title),
    messages,
    createdAt: normalizeIsoString(value.createdAt, now),
    updatedAt: normalizeIsoString(value.updatedAt, now),
    titleGeneratedAt: typeof value.titleGeneratedAt === 'string' || value.titleGeneratedAt instanceof Date
      ? normalizeIsoString(value.titleGeneratedAt, now)
      : undefined,
  };
}

function isStoredMessage(value) {
  return (
    value
    && typeof value === 'object'
    && typeof value.id === 'string'
    && ['assistant', 'user', 'system'].includes(value.role)
    && typeof value.content === 'string'
    && typeof value.createdAt === 'string'
  );
}

function normalizeIsoString(value, fallbackValue) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? fallbackValue : value.toISOString();
  }

  if (typeof value !== 'string') {
    return fallbackValue;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallbackValue : date.toISOString();
}

function buildConversationTitleContext(messages) {
  const roleLabels = {
    assistant: 'AI',
    system: '系统',
    user: '用户',
  };

  return messages
    .slice(-24)
    .map((message) => `${roleLabels[message.role] ?? message.role}：${message.content.trim()}`)
    .join('\n')
    .slice(-6000);
}

function sanitizeConversationTitle(value) {
  if (typeof value !== 'string') {
    return DEFAULT_CONVERSATION_TITLE;
  }

  const normalizedTitle = value
    .replace(/["'“”‘’《》「」]/g, '')
    .replace(/\s+/g, '')
    .trim();

  if (!normalizedTitle) {
    return DEFAULT_CONVERSATION_TITLE;
  }

  return Array.from(normalizedTitle).slice(0, 12).join('');
}

function extractCompletionText(payload) {
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((item) => {
      if (typeof item?.text === 'string') {
        return item.text;
      }

      if (typeof item?.content === 'string') {
        return item.content;
      }

      return '';
    })
    .join('');
}

function isChatMessage(value) {
  return (
    value
    && typeof value === 'object'
    && ['assistant', 'user', 'system'].includes(value.role)
    && typeof value.content === 'string'
    && value.content.trim().length > 0
  );
}

function normalizeScreenKnowledge(value) {
  if (!value || typeof value !== 'object') {
    return '当前屏幕内容读取暂未接入。';
  }

  const route = typeof value.route === 'string' ? value.route : 'unknown';
  const summary = typeof value.summary === 'string' ? value.summary : '当前屏幕内容读取暂未接入。';
  return `页面路径：${route}\n页面摘要：${summary}`;
}

function getDeepSeekTitleModel() {
  return normalizeConfiguredModel(getEnvValue('DEEPSEEK_TITLE_MODEL'))
    || DEFAULT_DEEPSEEK_TITLE_MODEL;
}

function normalizeConfiguredModel(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : '';
}

function resolveChatUpstream(model) {
  if (isDeepSeekModel(model)) {
    return {
      apiKey: getEnvValue('DEEPSEEK_API_KEY'),
      apiKeyName: 'DEEPSEEK_API_KEY',
      url: DEEPSEEK_URL,
    };
  }

  return {
    apiKey: getEnvValue('NITRO_ROUTER_API_KEY'),
    apiKeyName: 'NITRO_ROUTER_API_KEY',
    url: NITRO_ROUTER_URL,
  };
}

function isDeepSeekModel(model) {
  return typeof model === 'string'
    && model.trim().toLowerCase().startsWith(DEEPSEEK_MODEL_PREFIX);
}

function normalizeModel(value) {
  return normalizeConfiguredModel(value)
    || normalizeConfiguredModel(getEnvValue('NITRO_ROUTER_MODEL'))
    || DEFAULT_MODEL;
}

async function fetchCompatibleModels({
  apiKey,
  apiKeyName,
  modelsUrl,
  providerName,
}) {
  if (!apiKey) {
    return [];
  }

  try {
    const upstreamResponse = await fetch(modelsUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    const upstreamData = await upstreamResponse.json().catch(() => null);

    if (!upstreamResponse.ok) {
      throw new Error(getUpstreamError(upstreamData) || `${providerName} 模型列表获取失败。`);
    }

    return Array.isArray(upstreamData?.data)
      ? upstreamData.data.filter(isModelItem).map((model) => ({ id: model.id }))
      : [];
  } catch (error) {
    console.warn(`[AI] ${providerName} 模型列表获取失败: ${getRuntimeErrorMessage(error)}; key=${apiKeyName}`);
    return [];
  }
}

function isModelItem(value) {
  return value && typeof value === 'object' && typeof value.id === 'string';
}

function mergeModelItems(...modelGroups) {
  const seenModelIds = new Set();
  const mergedModels = [];

  for (const group of modelGroups) {
    for (const model of group) {
      if (seenModelIds.has(model.id)) {
        continue;
      }

      seenModelIds.add(model.id);
      mergedModels.push(model);
    }
  }

  return mergedModels;
}

function getUpstreamError(data) {
  const error = data?.error;

  if (typeof error === 'string') {
    return translateUpstreamErrorMessage(error);
  }

  if (typeof error?.message === 'string') {
    return translateUpstreamErrorMessage(error.message);
  }

  return null;
}

function translateUpstreamErrorMessage(message) {
  if (/insufficient balance/i.test(message)) {
    return '上游账户余额不足，请先充值后再继续使用该模型。';
  }

  if (/no available channel/i.test(message)) {
    return '当前模型在上游渠道不可用，请切换模型或检查渠道配置。';
  }

  return message;
}

function appendDocumentedDeepSeekModels(models) {
  if (models.length === 0) {
    return models;
  }

  // [变更] 修改前: 直接信任 DeepSeek /models 返回值，兼容别名模型不会出现在前端列表中
  // [变更] 修改后: 在官方文档声明的基础上补齐 deepseek-chat 和 deepseek-reasoner 两个兼容别名
  // [原因] 用户明确要求模型选择器展示 DeepSeek 当前全部可用模型
  return mergeModelItems(models, [
    { id: 'deepseek-chat' },
    { id: 'deepseek-reasoner' },
  ]);
}

function consumeSsePayload(buffer) {
  const normalizedBuffer = buffer.replace(/\r\n/g, '\n');
  const rawEvents = normalizedBuffer.split('\n\n');
  const rest = rawEvents.pop() ?? '';
  const events = rawEvents
    .map((eventBlock) => parseUpstreamSseEvent(eventBlock))
    .filter((event) => event !== null);

  return {
    events,
    rest,
  };
}

function parseUpstreamSseEvent(block) {
  const lines = block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith(':')) {
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  const payload = dataLines.join('\n');

  if (payload === '[DONE]') {
    return payload;
  }

  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function extractStreamText(payload) {
  const content = payload?.choices?.[0]?.delta?.content;

  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((item) => {
      if (typeof item?.text === 'string') {
        return item.text;
      }

      return '';
    })
    .join('');
}

function getRuntimeErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'AI 服务暂时不可用，请稍后再试。';
}

function getEnvValue(key) {
  if (typeof process.env?.[key] === 'string' && process.env[key].trim()) {
    return process.env[key].trim();
  }

  return undefined;
}

function loadLocalEnv() {
  if (!existsSync('.env')) {
    return;
  }

  const envLines = readFileSync('.env', 'utf8').split('\n');

  for (const line of envLines) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`AI server is running on http://127.0.0.1:${PORT}`);
