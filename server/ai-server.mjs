import { existsSync, readFileSync } from 'node:fs';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import pg from 'pg';

loadLocalEnv();

const NITRO_ROUTER_URL = 'https://api.nitrorouter.com/v1/chat/completions';
const NITRO_ROUTER_MODELS_URL = 'https://api.nitrorouter.com/v1/models';
const DEFAULT_MODEL = 'gemini-3.1-pro-preview';
const TITLE_SUMMARY_MODEL = 'gpt-5-nano';
const DEFAULT_CONVERSATION_TITLE = '对话标题';
const PORT = Number(process.env.AI_SERVER_PORT || 8787);
const { Pool } = pg;

const app = new Hono();
let databasePool = null;

app.use('*', cors());

app.get('/health', (c) => c.json({ ok: true }));

app.get('/api/ai/models', async (c) => {
  const apiKey = process.env.NITRO_ROUTER_API_KEY;

  if (!apiKey) {
    return c.json({ error: '缺少 NITRO_ROUTER_API_KEY，请先在后端环境变量中配置。' }, 500);
  }

  const upstreamResponse = await fetch(NITRO_ROUTER_MODELS_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  const upstreamData = await upstreamResponse.json().catch(() => null);

  if (!upstreamResponse.ok) {
    return c.json({
      error: getUpstreamError(upstreamData) || '模型列表获取失败。',
    }, upstreamResponse.status);
  }

  return c.json({ data: Array.isArray(upstreamData?.data) ? upstreamData.data : [] });
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
  const apiKey = process.env.NITRO_ROUTER_API_KEY;

  if (!apiKey) {
    return c.json({ error: '缺少 NITRO_ROUTER_API_KEY，请先在后端环境变量中配置。' }, 500);
  }

  const body = await c.req.json().catch(() => null);
  const messages = Array.isArray(body?.messages)
    ? body.messages.filter(isChatMessage)
    : [];

  if (messages.length === 0) {
    return c.json({ error: '缺少可用于总结标题的对话内容。' }, 400);
  }

  const conversationText = buildConversationTitleContext(messages);
  const upstreamResponse = await fetch(NITRO_ROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: TITLE_SUMMARY_MODEL,
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
  const apiKey = process.env.NITRO_ROUTER_API_KEY;

  if (!apiKey) {
    return c.json({ error: '缺少 NITRO_ROUTER_API_KEY，请先在后端环境变量中配置。' }, 500);
  }

  const body = await c.req.json().catch(() => null);
  const userMessages = Array.isArray(body?.messages)
    ? body.messages.filter(isChatMessage)
    : [];
  const screenKnowledge = normalizeScreenKnowledge(body?.screenKnowledge);
  const model = normalizeModel(body?.model);

  if (userMessages.length === 0) {
    return c.json({ error: '缺少可发送给 AI 的对话消息。' }, 400);
  }

  const upstreamResponse = await fetch(NITRO_ROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
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
  const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);

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
  if (process.env.DATABASE_SSL === 'true') {
    return true;
  }

  if (process.env.DATABASE_SSL === 'false') {
    return false;
  }

  return !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(databaseUrl);
}

async function readConversations() {
  const { rows } = await getDatabasePool().query(`
    SELECT id, title, messages, created_at, updated_at, title_generated_at
    FROM ai_conversations
    ORDER BY updated_at DESC
  `);

  return rows.map(normalizeConversationRow).filter(Boolean);
}

async function upsertConversation(conversation) {
  const { rows } = await getDatabasePool().query(`
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
  const { rows } = await getDatabasePool().query(`
    SELECT id, title, messages, created_at, updated_at, title_generated_at
    FROM ai_conversations
    WHERE id = $1
  `, [conversationId]);

  return rows[0] ? normalizeConversationRow(rows[0]) : null;
}

async function deleteConversation(conversationId) {
  await getDatabasePool().query('DELETE FROM ai_conversations WHERE id = $1', [conversationId]);
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

function normalizeModel(value) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  return process.env.NITRO_ROUTER_MODEL || DEFAULT_MODEL;
}

function getUpstreamError(data) {
  const error = data?.error;

  if (typeof error === 'string') {
    return error;
  }

  if (typeof error?.message === 'string') {
    return error.message;
  }

  return null;
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
