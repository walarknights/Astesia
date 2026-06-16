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
