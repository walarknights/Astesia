import { existsSync, readFileSync } from 'node:fs';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

loadLocalEnv();

const NITRO_ROUTER_URL = 'https://api.nitrorouter.com/v1/chat/completions';
const NITRO_ROUTER_MODELS_URL = 'https://api.nitrorouter.com/v1/models';
const DEFAULT_MODEL = 'gemini-3.1-pro-preview';
const PORT = Number(process.env.AI_SERVER_PORT || 8787);

const app = new Hono();

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
  });

  const upstreamData = await upstreamResponse.json().catch(() => null);

  if (!upstreamResponse.ok) {
    return c.json({
      error: getUpstreamError(upstreamData) || 'AI 上游服务返回异常。',
    }, upstreamResponse.status);
  }

  const content = upstreamData?.choices?.[0]?.message?.content;

  if (typeof content !== 'string' || !content.trim()) {
    return c.json({ error: 'AI 上游服务未返回有效内容。' }, 502);
  }

  return c.json({ content: content.trim() });
});

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
