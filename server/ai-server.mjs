import { Buffer } from 'node:buffer';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import nodemailer from 'nodemailer';
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
const DEFAULT_CHAT_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_AI_SERVER_HOST = '127.0.0.1';
const CHAT_MAX_OUTPUT_TOKENS = normalizePositiveInteger(
  getEnvValue('AI_CHAT_MAX_OUTPUT_TOKENS'),
  DEFAULT_CHAT_MAX_OUTPUT_TOKENS
);
const DEFAULT_MODEL_PRICING = Object.freeze({
  'deepseek-v4-flash': {
    inputPerMillionUsd: 0.14,
    cachedInputPerMillionUsd: 0.0028,
    outputPerMillionUsd: 0.28,
  },
  'deepseek-chat': {
    inputPerMillionUsd: 0.14,
    cachedInputPerMillionUsd: 0.0028,
    outputPerMillionUsd: 0.28,
  },
  'deepseek-reasoner': {
    inputPerMillionUsd: 0.14,
    cachedInputPerMillionUsd: 0.0028,
    outputPerMillionUsd: 0.28,
  },
  'deepseek-v4-pro': {
    inputPerMillionUsd: 0.435,
    cachedInputPerMillionUsd: 0.003625,
    outputPerMillionUsd: 0.87,
  },
  'gemini-3.1-pro-preview': {
    inputPerMillionUsd: 2,
    cachedInputPerMillionUsd: 0.2,
    outputPerMillionUsd: 12,
  },
});
const PORT = Number(getEnvValue('AI_SERVER_PORT') || 8787);
const HOST = normalizeServerHost(getEnvValue('AI_SERVER_HOST')) || DEFAULT_AI_SERVER_HOST;
const { Pool } = pg;

const app = new Hono();
let databasePool = null;
let brevoSmtpTransporter = null;
let hasLoggedBrevoSmtpConfigWarning = false;
const modelPricingMap = createModelPricingMap(getEnvValue('AI_MODEL_PRICING_JSON'));
const AI_INITIAL_BALANCE_USD = normalizeNonNegativeNumber(
  getEnvValue('AI_INITIAL_BALANCE_USD'),
  1
);
const AI_USER_ID_HEADER = 'x-ai-user-id';
const AUTH_REGISTER_CODE_PURPOSE = 'register';
const AUTH_VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000;
const AUTH_VERIFICATION_CODE_THROTTLE_SECONDS = 60;
const AUTH_VERIFICATION_CODE_THROTTLE_MS = AUTH_VERIFICATION_CODE_THROTTLE_SECONDS * 1000;
const AUTH_DEFAULT_PLAN_NAME = '普通计划';
const AUTH_DEFAULT_SIGNATURE = '欢迎来到 Astesia';
const AUTH_TOKEN_ISSUER = 'astesia-auth';
const AUTH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const AUTH_TOKEN_SECRET = getEnvValue('AUTH_TOKEN_SECRET') || 'astesia-local-auth-secret';
const BREVO_SMTP_HOST = getEnvValue('BREVO_SMTP_HOST') || 'smtp-relay.brevo.com';
const BREVO_SMTP_PORT = normalizePositiveInteger(getEnvValue('BREVO_SMTP_PORT'), 587);
const BREVO_SMTP_USER = getEnvValue('BREVO_SMTP_USER');
const BREVO_SMTP_KEY = getEnvValue('BREVO_SMTP_KEY')
  || getEnvValue('BREVO_SMTP_API_KEY')
  || getEnvValue('BREVO_SMTP_PASSWORD');
const BREVO_SMTP_FROM_EMAIL = normalizeAuthEmail(getEnvValue('BREVO_SMTP_FROM_EMAIL'));
const BREVO_SMTP_FROM_NAME = getEnvValue('BREVO_SMTP_FROM_NAME') || 'Astesia';
const AUTH_RETURN_DEBUG_VERIFICATION_CODE = normalizeBooleanEnv(
  getEnvValue('AUTH_RETURN_DEBUG_VERIFICATION_CODE'),
  false
);

class AiAuthenticationError extends Error {}

class RequestValidationError extends Error {
  constructor(message, status = 400, details = null) {
    super(message);
    this.status = status;

    if (details && typeof details === 'object') {
      Object.assign(this, details);
    }
  }
}

class InsufficientAiBalanceError extends Error {
  constructor(balanceUsd, requiredUsd) {
    super(`AI 余额不足，当前余额 $${formatUsdAmount(balanceUsd)}，至少需要预留 $${formatUsdAmount(requiredUsd)} 才能发起本次对话。`);
    this.balanceUsd = balanceUsd;
    this.requiredUsd = requiredUsd;
  }
}

app.use('*', cors({
  allowHeaders: ['Accept', 'Authorization', 'Content-Type', AI_USER_ID_HEADER],
}));

app.get('/health', (c) => c.json({ ok: true }));

app.post('/api/auth/register/code', async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = normalizeAuthEmail(body?.email);

  if (!email) {
    return c.json({ error: '请输入有效的邮箱地址。' }, 400);
  }

  try {
    const existingUser = await readAuthUserByEmail(email);

    if (existingUser) {
      throw new RequestValidationError('该邮箱已注册，请直接使用邮箱和密码登录。', 409);
    }

    const verification = await issueEmailVerificationCode(email, AUTH_REGISTER_CODE_PURPOSE);

    return c.json({
      message: verification.message,
      verificationCode: verification.debugCode || undefined,
      expiresAt: verification.expiresAt,
      cooldownSeconds: AUTH_VERIFICATION_CODE_THROTTLE_SECONDS,
    });
  } catch (error) {
    return c.json({
      error: getRuntimeErrorMessage(error),
      retryAfterSeconds: getRetryAfterSeconds(error),
    }, getErrorStatus(error));
  }
});

app.post('/api/auth/register', async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = normalizeAuthEmail(body?.email);
  const verificationCode = normalizeVerificationCode(body?.verificationCode);
  const password = normalizeAuthPassword(body?.password);
  const displayName = body?.displayName;

  if (!email) {
    return c.json({ error: '请输入有效的邮箱地址。' }, 400);
  }

  if (!verificationCode) {
    return c.json({ error: '请输入 6 位验证码。' }, 400);
  }

  if (!password) {
    return c.json({ error: '密码至少需要 6 位。' }, 400);
  }

  try {
    const user = await registerAuthUser({
      email,
      verificationCode,
      password,
      displayName,
    });

    return c.json(buildAuthSuccessResponse(user));
  } catch (error) {
    return c.json({ error: getRuntimeErrorMessage(error) }, getErrorStatus(error));
  }
});

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = normalizeAuthEmail(body?.email);
  const password = normalizeAuthPassword(body?.password);

  if (!email) {
    return c.json({ error: '请输入有效的邮箱地址。' }, 400);
  }

  if (!password) {
    return c.json({ error: '请输入正确的邮箱和密码。' }, 400);
  }

  try {
    const user = await loginAuthUser({ email, password });
    return c.json(buildAuthSuccessResponse(user));
  } catch (error) {
    return c.json({ error: getRuntimeErrorMessage(error) }, getErrorStatus(error));
  }
});

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

app.get('/api/ai/billing/summary', async (c) => {
  try {
    const aiUser = resolveRequiredAiUser(c);
    return c.json(await getAiBillingSummary(aiUser.userId));
  } catch (error) {
    return c.json({ error: getRuntimeErrorMessage(error) }, error instanceof AiAuthenticationError ? 401 : 500);
  }
});

app.get('/api/admin/ai/statistics', async (c) => {
  try {
    await resolveRequiredAdminUser(c);
    const userLimit = normalizeBoundedPositiveInteger(c.req.query('userLimit'), 100, 500);
    const topLimit = normalizeBoundedPositiveInteger(c.req.query('topLimit'), 10, 50);

    return c.json(await getAiUsageStatistics({ userLimit, topLimit }));
  } catch (error) {
    return c.json({ error: getRuntimeErrorMessage(error) }, getErrorStatus(error));
  }
});

app.get('/api/ai/conversations', async (c) => {
  try {
    const aiUser = resolveRequiredAiUser(c);
    return c.json({ conversations: await readConversations(aiUser.userId) });
  } catch (error) {
    return c.json({ error: getRuntimeErrorMessage(error) }, error instanceof AiAuthenticationError ? 401 : 500);
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
    const aiUser = resolveRequiredAiUser(c);
    return c.json({ conversation: await upsertConversation(aiUser.userId, conversation) });
  } catch (error) {
    return c.json({ error: getRuntimeErrorMessage(error) }, error instanceof AiAuthenticationError ? 401 : 500);
  }
});

app.delete('/api/ai/conversations/:id', async (c) => {
  const conversationId = c.req.param('id');

  try {
    const aiUser = resolveRequiredAiUser(c);
    await deleteConversation(aiUser.userId, conversationId);
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ error: getRuntimeErrorMessage(error) }, error instanceof AiAuthenticationError ? 401 : 500);
  }
});

app.post('/api/ai/conversations/summarize-title', async (c) => {
  const apiKey = getEnvValue('DEEPSEEK_API_KEY');

  if (!apiKey) {
    return c.json({ error: '缺少 DEEPSEEK_API_KEY，请先在后端环境变量中配置。' }, 500);
  }

  try {
    resolveRequiredAiUser(c);
  } catch (error) {
    return c.json({ error: getRuntimeErrorMessage(error) }, error instanceof AiAuthenticationError ? 401 : 500);
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
  let aiUser;

  try {
    aiUser = resolveRequiredAiUser(c);
  } catch (error) {
    return c.json({ error: getRuntimeErrorMessage(error) }, error instanceof AiAuthenticationError ? 401 : 500);
  }

  const userMessages = Array.isArray(body?.messages)
    ? body.messages.filter(isChatMessage)
    : [];
  const screenKnowledge = normalizeScreenKnowledge(body?.screenKnowledge);
  const model = normalizeModel(body?.model);
  const chatUpstream = resolveChatUpstream(model);
  const conversationId = normalizeConversationId(body?.conversationId);
  const modelPricing = resolveModelPricing(model);
  const usageRequestId = createAiUsageRequestId(aiUser.userId, conversationId);

  if (userMessages.length === 0) {
    return c.json({ error: '缺少可发送给 AI 的对话消息。' }, 400);
  }

  if (!modelPricing) {
    return c.json({
      error: `模型 ${model} 尚未配置计费单价，请先在服务端补齐价格表后再启用收费。`,
    }, 400);
  }

  if (!chatUpstream.apiKey) {
    return c.json({ error: `缺少 ${chatUpstream.apiKeyName}，请先在后端环境变量中配置。` }, 500);
  }

  const chatMessages = [
    {
      role: 'system',
      // [变更] 修改前: 后端总是把“当前屏幕知识库”注入系统提示词
      // [变更] 修改后: 只有前端显式传入 screenKnowledge 时才追加相关约束和上下文
      // [原因] 用户需要自己决定本轮对话是否使用当前屏幕知识
      content: [
        '你是 Astesia App 内的移动端 AI 助手。',
        screenKnowledge
          ? '回答需要简洁、友好，并在用户开启时结合当前屏幕知识库。'
          : '回答需要简洁、友好。',
        screenKnowledge ? `当前屏幕知识库：${screenKnowledge}` : null,
      ].filter(Boolean).join('\n'),
    },
    ...userMessages,
  ];

  // [变更] 修改前: 聊天请求不会校验用户余额，返回多少 token 就被动承担多少上游成本
  // [变更] 修改后: 先按“保守输入估算 + 最大输出上限”预留本次请求余额，再在流式结束后按真实 usage 结算
  // [原因] 需要支持按登录用户扣费，同时避免并发请求把余额透支
  const reserveUsd = estimateAiRequestReserveUsd(chatMessages, modelPricing, CHAT_MAX_OUTPUT_TOKENS);

  try {
    await reserveAiWalletBalance({
      userId: aiUser.userId,
      requestId: usageRequestId,
      reservedUsd: reserveUsd,
    });
  } catch (error) {
    if (error instanceof InsufficientAiBalanceError) {
      return c.json({ error: error.message }, 402);
    }

    return c.json({ error: getRuntimeErrorMessage(error) }, 500);
  }

  let upstreamResponse;

  try {
    upstreamResponse = await fetch(chatUpstream.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${chatUpstream.apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
        stream_options: {
          include_usage: true,
        },
        max_tokens: CHAT_MAX_OUTPUT_TOKENS,
        messages: chatMessages,
      }),
      signal: c.req.raw.signal,
    });
  } catch (error) {
    // [变更] 修改前: 额度预留后若上游连接直接失败，reservation 会一直占用用户余额
    // [变更] 修改后: 上游尚未产生有效响应时立即释放预留额度
    // [原因] 保证请求失败路径与正常结算路径都能闭合钱包事务
    await releaseAiWalletReservation({
      userId: aiUser.userId,
      requestId: usageRequestId,
    }).catch(() => null);

    return c.json({ error: getRuntimeErrorMessage(error) }, 502);
  }

  if (!upstreamResponse.ok) {
    const upstreamData = await upstreamResponse.json().catch(() => null);
    await releaseAiWalletReservation({
      userId: aiUser.userId,
      requestId: usageRequestId,
    }).catch(() => null);

    return c.json({
      error: getUpstreamError(upstreamData) || 'AI 上游服务返回异常。',
    }, upstreamResponse.status);
  }

  const upstreamReader = upstreamResponse.body?.getReader();

  if (!upstreamReader) {
    await releaseAiWalletReservation({
      userId: aiUser.userId,
      requestId: usageRequestId,
    }).catch(() => null);
    return c.json({ error: 'AI 上游服务未提供可读取的流式响应。' }, 502);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let buffer = '';
  let hasStreamedContent = false;
  let latestUsage = null;
  let providerRequestId = '';
  let isReservationSettled = false;

  const releaseReservedBalance = async () => {
    if (isReservationSettled) {
      return;
    }

    isReservationSettled = true;
    await releaseAiWalletReservation({
      userId: aiUser.userId,
      requestId: usageRequestId,
    });
  };

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

            if (typeof payload?.id === 'string' && payload.id.trim()) {
              providerRequestId = payload.id.trim();
            }

            const usage = extractStreamUsage(payload);

            if (usage) {
              latestUsage = usage;
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

          if (typeof payload?.id === 'string' && payload.id.trim()) {
            providerRequestId = payload.id.trim();
          }

          const usage = extractStreamUsage(payload);

          if (usage) {
            latestUsage = usage;
          }

          const chunk = extractStreamText(payload);

          if (!chunk) {
            continue;
          }

          hasStreamedContent = true;
          emitEvent('chunk', { content: chunk });
        }

        if (!hasStreamedContent) {
            await releaseReservedBalance();
          emitEvent('error', { message: 'AI 上游服务未返回有效内容。' });
          controller.close();
          return;
        }

          if (!latestUsage) {
            await releaseReservedBalance();
            emitEvent('error', { message: 'AI 上游服务未返回可计费 usage，本次对话已取消结算。' });
            controller.close();
            return;
          }

          const usageCharge = computeAiUsageCharge(latestUsage, modelPricing);
          const walletSummary = await finalizeAiUsageCharge({
            requestId: usageRequestId,
            userId: aiUser.userId,
            conversationId,
            provider: chatUpstream.providerName,
            model,
            usage: latestUsage,
            pricing: modelPricing,
            charge: usageCharge,
          });

          isReservationSettled = true;
          emitEvent('done', {
            requestId: usageRequestId,
            providerRequestId: providerRequestId || undefined,
            usage: serializeUsageMetrics(latestUsage),
            billing: {
              totalCostUsd: formatUsdAmount(usageCharge.totalCostUsd),
              remainingBalanceUsd: formatUsdAmount(walletSummary.balanceUsd),
              totalChargedUsd: formatUsdAmount(walletSummary.totalChargedUsd),
            },
          });
        controller.close();
      } catch (error) {
          await releaseReservedBalance().catch(() => null);
        emitEvent('error', { message: getRuntimeErrorMessage(error) });
        controller.close();
      } finally {
        upstreamReader.releaseLock();
      }
    },
    async cancel() {
      await upstreamReader.cancel().catch(() => null);
        await releaseReservedBalance().catch(() => null);
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

function normalizeServerHost(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function resolveRequiredAiUser(c) {
  const headerUserId = normalizeAiUserId(c.req.header(AI_USER_ID_HEADER));
  const bearerToken = getBearerToken(c.req.header('authorization'));

  if (!bearerToken) {
    throw new AiAuthenticationError('缺少登录 token，请重新登录后再继续使用 AI 对话。');
  }

  const tokenUserId = extractUserIdFromBearerToken(bearerToken);

  if (!tokenUserId) {
    throw new AiAuthenticationError('登录 token 已失效，请重新登录后再继续使用 AI 对话。');
  }

  if (headerUserId && headerUserId !== tokenUserId) {
    throw new AiAuthenticationError('AI 用户身份校验失败，请重新登录后再试。');
  }

  return { userId: tokenUserId };
}

async function resolveRequiredAdminUser(c) {
  const aiUser = resolveRequiredAiUser(c);
  const user = await readAuthUserById(aiUser.userId);

  if (!user) {
    throw new AiAuthenticationError('登录用户不存在，请重新登录后再试。');
  }

  if (user.role !== 'admin') {
    throw new RequestValidationError('仅管理员可以查看 AI 用量统计。', 403);
  }

  return user;
}

function normalizeAiUserId(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalizedValue = value.trim();
  return /^[A-Za-z0-9._:@-]{1,128}$/.test(normalizedValue)
    ? normalizedValue
    : '';
}

function encodeBase64Url(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function getBearerToken(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

function extractUserIdFromBearerToken(token) {
  if (!token || token.split('.').length < 2) {
    return '';
  }

  try {
    const [headerSegment, payloadSegment, signatureSegment = ''] = token.split('.');
    const payload = JSON.parse(decodeBase64Url(payloadSegment));

    if (payload?.iss !== AUTH_TOKEN_ISSUER) {
      return '';
    }

    const expectedSignature = createAuthTokenSignature(`${headerSegment}.${payloadSegment}`);

    if (!safeEqualSignature(signatureSegment, expectedSignature)) {
      return '';
    }

    const expiresAt = normalizeFiniteNumber(payload?.exp, 0);

    if (expiresAt <= Math.floor(Date.now() / 1000)) {
      return '';
    }

    for (const key of ['userId', 'user_id', 'uid', 'sub']) {
      const normalizedUserId = normalizeAiUserId(String(payload?.[key] ?? ''));

      if (normalizedUserId) {
        return normalizedUserId;
      }
    }
  } catch {
    return '';
  }

  return '';
}

function decodeBase64Url(value) {
  const normalizedValue = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalizedValue.length % 4 === 0
    ? ''
    : '='.repeat(4 - (normalizedValue.length % 4));

  return Buffer.from(`${normalizedValue}${padding}`, 'base64').toString('utf8');
}

function normalizePositiveInteger(value, fallbackValue) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0
    ? numericValue
    : fallbackValue;
}

function normalizeBoundedPositiveInteger(value, fallbackValue, maxValue) {
  return Math.min(normalizePositiveInteger(value, fallbackValue), maxValue);
}

function normalizeNonNegativeInteger(value, fallbackValue = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0
    ? Math.floor(numericValue)
    : fallbackValue;
}

function normalizeFiniteNumber(value, fallbackValue = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallbackValue;
}

function normalizeNonNegativeNumber(value, fallbackValue = 0) {
  const numericValue = normalizeFiniteNumber(value, fallbackValue);
  return numericValue >= 0 ? numericValue : fallbackValue;
}

function normalizeBooleanEnv(value, fallbackValue = false) {
  if (typeof value !== 'string') {
    return fallbackValue;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalizedValue)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalizedValue)) {
    return false;
  }

  return fallbackValue;
}

function roundUsdAmount(value) {
  return Number(normalizeFiniteNumber(value, 0).toFixed(8));
}

function formatUsdAmount(value) {
  return roundUsdAmount(value).toFixed(8).replace(/\.?0+$/, '');
}

function normalizeConversationId(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalizedValue = value.trim();
  return normalizedValue.length > 0 && normalizedValue.length <= 128
    ? normalizedValue
    : '';
}

function createModelPricingMap(rawConfig) {
  const pricingMap = new Map();

  for (const [modelId, pricing] of Object.entries(DEFAULT_MODEL_PRICING)) {
    const normalizedPricing = normalizeModelPricingEntry(pricing);

    if (normalizedPricing) {
      pricingMap.set(modelId, normalizedPricing);
    }
  }

  if (!rawConfig) {
    return pricingMap;
  }

  try {
    const parsedConfig = JSON.parse(rawConfig);

    if (!parsedConfig || typeof parsedConfig !== 'object' || Array.isArray(parsedConfig)) {
      throw new Error('AI_MODEL_PRICING_JSON 必须是对象。');
    }

    for (const [modelId, pricing] of Object.entries(parsedConfig)) {
      const normalizedModelId = normalizeConfiguredModel(modelId);
      const normalizedPricing = normalizeModelPricingEntry(pricing);

      if (!normalizedModelId || !normalizedPricing) {
        console.warn(`[AI] 跳过无效模型计费配置: ${modelId}`);
        continue;
      }

      pricingMap.set(normalizedModelId, normalizedPricing);
    }
  } catch (error) {
    console.warn(`[AI] AI_MODEL_PRICING_JSON 解析失败: ${getRuntimeErrorMessage(error)}`);
  }

  return pricingMap;
}

function normalizeModelPricingEntry(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const inputPerMillionUsd = normalizeFiniteNumber(value.inputPerMillionUsd, Number.NaN);
  const cachedInputPerMillionUsd = normalizeFiniteNumber(
    value.cachedInputPerMillionUsd ?? value.inputPerMillionUsd,
    Number.NaN
  );
  const outputPerMillionUsd = normalizeFiniteNumber(value.outputPerMillionUsd, Number.NaN);

  if (
    !Number.isFinite(inputPerMillionUsd)
    || inputPerMillionUsd < 0
    || !Number.isFinite(cachedInputPerMillionUsd)
    || cachedInputPerMillionUsd < 0
    || !Number.isFinite(outputPerMillionUsd)
    || outputPerMillionUsd < 0
  ) {
    return null;
  }

  return {
    inputPerMillionUsd,
    cachedInputPerMillionUsd,
    outputPerMillionUsd,
  };
}

function resolveModelPricing(model) {
  return modelPricingMap.get(model) ?? null;
}

function estimateAiRequestReserveUsd(chatMessages, modelPricing, maxOutputTokens) {
  const promptTokenEstimate = estimateMessageTokenCount(chatMessages);
  const inputCostUsd = (promptTokenEstimate * modelPricing.inputPerMillionUsd) / 1_000_000;
  const outputCostUsd = (Math.max(maxOutputTokens, 0) * modelPricing.outputPerMillionUsd) / 1_000_000;

  return roundUsdAmount((inputCostUsd + outputCostUsd) * 1.15);
}

function estimateMessageTokenCount(messages) {
  return messages.reduce((tokenCount, message) => (
    tokenCount + estimateTextTokenCount(message.role) + estimateTextTokenCount(message.content) + 16
  ), 4);
}

function estimateTextTokenCount(value) {
  return typeof value === 'string' && value.trim()
    ? Math.max(Buffer.byteLength(value, 'utf8'), 1)
    : 0;
}

function createAiUsageRequestId(userId, conversationId) {
  const userPart = sanitizeIdentifierFragment(userId, 'user');
  const conversationPart = sanitizeIdentifierFragment(conversationId, 'adhoc');
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 10);

  return `ai-${userPart}-${conversationPart}-${timestamp}-${randomPart}`;
}

function sanitizeIdentifierFragment(value, fallbackValue) {
  if (typeof value !== 'string') {
    return fallbackValue;
  }

  const sanitizedValue = value
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

  return sanitizedValue || fallbackValue;
}

function extractStreamUsage(payload) {
  const usage = payload?.usage;

  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const promptTokens = normalizeNonNegativeInteger(
    usage.prompt_tokens ?? usage.promptTokens ?? usage.input_tokens,
    0
  );
  const cachedPromptTokens = normalizeNonNegativeInteger(
    usage.cached_prompt_tokens
      ?? usage.prompt_cache_hit_tokens
      ?? usage.prompt_tokens_details?.cached_tokens
      ?? usage.input_tokens_details?.cached_tokens,
    0
  );
  const totalTokens = normalizeNonNegativeInteger(
    usage.total_tokens ?? usage.totalTokens,
    promptTokens
  );
  const completionTokensFromPayload = normalizeNonNegativeInteger(
    usage.completion_tokens ?? usage.completionTokens ?? usage.output_tokens,
    0
  );
  const completionTokens = completionTokensFromPayload > 0
    ? completionTokensFromPayload
    : Math.max(totalTokens - promptTokens, 0);
  const reasoningTokens = normalizeNonNegativeInteger(
    usage.reasoning_tokens
      ?? usage.completion_tokens_details?.reasoning_tokens
      ?? usage.output_tokens_details?.reasoning_tokens,
    0
  );

  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) {
    return null;
  }

  return {
    promptTokens,
    cachedPromptTokens: Math.min(cachedPromptTokens, promptTokens),
    completionTokens,
    reasoningTokens: Math.min(reasoningTokens, completionTokens),
    totalTokens: Math.max(totalTokens, promptTokens + completionTokens),
  };
}

function computeAiUsageCharge(usage, pricing) {
  const cachedPromptTokens = Math.min(usage.cachedPromptTokens, usage.promptTokens);
  const uncachedPromptTokens = Math.max(usage.promptTokens - cachedPromptTokens, 0);
  const inputCostUsd = roundUsdAmount(
    (
      (uncachedPromptTokens * pricing.inputPerMillionUsd)
      + (cachedPromptTokens * pricing.cachedInputPerMillionUsd)
    ) / 1_000_000
  );
  const outputCostUsd = roundUsdAmount(
    (usage.completionTokens * pricing.outputPerMillionUsd) / 1_000_000
  );

  return {
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: roundUsdAmount(inputCostUsd + outputCostUsd),
  };
}

function serializeUsageMetrics(usage) {
  return {
    promptTokens: usage.promptTokens,
    cachedPromptTokens: usage.cachedPromptTokens,
    completionTokens: usage.completionTokens,
    reasoningTokens: usage.reasoningTokens,
    totalTokens: usage.totalTokens,
  };
}

async function ensureAiWalletExists(queryable, userId) {
  await queryable.query(`
    INSERT INTO ai_user_wallets (user_id, balance_usd, total_charged_usd)
    VALUES ($1, $2, 0)
    ON CONFLICT (user_id) DO NOTHING
  `, [userId, AI_INITIAL_BALANCE_USD]);
}

async function getWalletSnapshot(queryable, userId) {
  await ensureAiWalletExists(queryable, userId);
  const { rows } = await queryable.query(`
    SELECT user_id, balance_usd, total_charged_usd
    FROM ai_user_wallets
    WHERE user_id = $1
  `, [userId]);

  const wallet = normalizeAiWalletRow(rows[0]);

  if (wallet) {
    return ensureAiWalletQuotaLimit(queryable, wallet);
  }

  return {
    userId,
    balanceUsd: roundUsdAmount(AI_INITIAL_BALANCE_USD),
    totalChargedUsd: 0,
  };
}

async function ensureAiWalletQuotaLimit(queryable, wallet) {
  const activeReservedUsd = await readActiveReservedUsd(queryable, wallet.userId);
  const targetBalanceUsd = roundUsdAmount(
    Math.max(AI_INITIAL_BALANCE_USD - wallet.totalChargedUsd - activeReservedUsd, 0)
  );

  if (targetBalanceUsd === wallet.balanceUsd) {
    return wallet;
  }

  const { rows } = await queryable.query(`
    UPDATE ai_user_wallets
    SET balance_usd = $2,
        updated_at = now()
    WHERE user_id = $1
    RETURNING user_id, balance_usd, total_charged_usd
  `, [wallet.userId, targetBalanceUsd]);

  return normalizeAiWalletRow(rows[0]) ?? {
    ...wallet,
    balanceUsd: targetBalanceUsd,
  };
}

async function readActiveReservedUsd(queryable, userId) {
  const { rows } = await queryable.query(`
    SELECT COALESCE(SUM(reserved_usd), 0) AS active_reserved_usd
    FROM ai_wallet_reservations
    WHERE user_id = $1
      AND status = 'reserved'
  `, [userId]);

  return roundUsdAmount(rows[0]?.active_reserved_usd);
}

function normalizeAiWalletRow(row) {
  if (!row || typeof row !== 'object' || typeof row.user_id !== 'string') {
    return null;
  }

  return {
    userId: row.user_id,
    balanceUsd: roundUsdAmount(row.balance_usd),
    totalChargedUsd: roundUsdAmount(row.total_charged_usd),
  };
}

async function readAiWalletReservationForUpdate(client, requestId) {
  const { rows } = await client.query(`
    SELECT request_id, user_id, reserved_usd, status
    FROM ai_wallet_reservations
    WHERE request_id = $1
    FOR UPDATE
  `, [requestId]);

  return normalizeAiWalletReservationRow(rows[0]);
}

function normalizeAiWalletReservationRow(row) {
  if (
    !row
    || typeof row !== 'object'
    || typeof row.request_id !== 'string'
    || typeof row.user_id !== 'string'
    || typeof row.status !== 'string'
  ) {
    return null;
  }

  return {
    requestId: row.request_id,
    userId: row.user_id,
    reservedUsd: roundUsdAmount(row.reserved_usd),
    status: row.status,
  };
}

async function readAiUsageRecordByRequestId(queryable, requestId) {
  const { rows } = await queryable.query(`
    SELECT
      request_id,
      user_id,
      conversation_id,
      provider,
      model,
      prompt_tokens,
      cached_prompt_tokens,
      completion_tokens,
      reasoning_tokens,
      total_tokens,
      input_cost_usd,
      output_cost_usd,
      total_cost_usd,
      currency,
      created_at
    FROM ai_usage_records
    WHERE request_id = $1
    LIMIT 1
  `, [requestId]);

  return normalizeAiUsageRecordRow(rows[0]);
}

function normalizeAiUsageRecordRow(row) {
  if (
    !row
    || typeof row !== 'object'
    || typeof row.request_id !== 'string'
    || typeof row.user_id !== 'string'
    || typeof row.provider !== 'string'
    || typeof row.model !== 'string'
  ) {
    return null;
  }

  const fallbackDate = new Date().toISOString();

  return {
    requestId: row.request_id,
    userId: row.user_id,
    conversationId: typeof row.conversation_id === 'string' ? row.conversation_id : null,
    provider: row.provider,
    model: row.model,
    usage: {
      promptTokens: normalizeNonNegativeInteger(row.prompt_tokens, 0),
      cachedPromptTokens: normalizeNonNegativeInteger(row.cached_prompt_tokens, 0),
      completionTokens: normalizeNonNegativeInteger(row.completion_tokens, 0),
      reasoningTokens: normalizeNonNegativeInteger(row.reasoning_tokens, 0),
      totalTokens: normalizeNonNegativeInteger(row.total_tokens, 0),
    },
    billing: {
      inputCostUsd: formatUsdAmount(row.input_cost_usd),
      outputCostUsd: formatUsdAmount(row.output_cost_usd),
      totalCostUsd: formatUsdAmount(row.total_cost_usd),
    },
    currency: typeof row.currency === 'string' ? row.currency : 'USD',
    createdAt: normalizeIsoString(row.created_at, fallbackDate),
  };
}

function normalizeAiBillingModelRow(row) {
  if (!row || typeof row !== 'object' || typeof row.model !== 'string') {
    return null;
  }

  const fallbackDate = new Date().toISOString();

  return {
    model: row.model,
    requestCount: normalizeNonNegativeInteger(row.request_count, 0),
    totalTokens: normalizeNonNegativeInteger(row.total_tokens, 0),
    totalCostUsd: formatUsdAmount(row.total_cost_usd),
    lastUsedAt: row.last_used_at
      ? normalizeIsoString(row.last_used_at, fallbackDate)
      : null,
  };
}

async function reserveAiWalletBalance({
  userId,
  requestId,
  reservedUsd,
}) {
  const normalizedReservedUsd = roundUsdAmount(Math.max(reservedUsd, 0));
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await ensureAiWalletExists(client, userId);

    const existingReservation = await readAiWalletReservationForUpdate(client, requestId);

    if (existingReservation) {
      if (existingReservation.userId !== userId) {
        throw new Error('AI 计费预留记录的用户身份不匹配。');
      }

      const wallet = await getWalletSnapshot(client, userId);
      await client.query('COMMIT');

      return {
        requestId,
        reservedUsd: existingReservation.reservedUsd,
        balanceUsd: wallet.balanceUsd,
        totalChargedUsd: wallet.totalChargedUsd,
      };
    }

    const { rows } = await client.query(`
      UPDATE ai_user_wallets
      SET balance_usd = balance_usd - $2,
          updated_at = now()
      WHERE user_id = $1
        AND balance_usd >= $2
      RETURNING balance_usd, total_charged_usd
    `, [userId, normalizedReservedUsd]);

    if (!rows[0]) {
      const wallet = await getWalletSnapshot(client, userId);
      throw new InsufficientAiBalanceError(wallet.balanceUsd, normalizedReservedUsd);
    }

    await client.query(`
      INSERT INTO ai_wallet_reservations (request_id, user_id, reserved_usd, status)
      VALUES ($1, $2, $3, 'reserved')
    `, [requestId, userId, normalizedReservedUsd]);

    await client.query('COMMIT');

    return {
      requestId,
      reservedUsd: normalizedReservedUsd,
      balanceUsd: roundUsdAmount(rows[0].balance_usd),
      totalChargedUsd: roundUsdAmount(rows[0].total_charged_usd),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

async function releaseAiWalletReservation({
  userId,
  requestId,
}) {
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await ensureAiWalletExists(client, userId);

    const reservation = await readAiWalletReservationForUpdate(client, requestId);

    if (!reservation) {
      const wallet = await getWalletSnapshot(client, userId);
      await client.query('COMMIT');
      return wallet;
    }

    if (reservation.userId !== userId) {
      throw new Error('AI 计费预留记录的用户身份不匹配。');
    }

    if (reservation.status !== 'reserved') {
      const wallet = await getWalletSnapshot(client, userId);
      await client.query('COMMIT');
      return wallet;
    }

    const { rows } = await client.query(`
      UPDATE ai_user_wallets
      SET balance_usd = balance_usd + $2,
          updated_at = now()
      WHERE user_id = $1
      RETURNING user_id, balance_usd, total_charged_usd
    `, [userId, reservation.reservedUsd]);

    await client.query(`
      UPDATE ai_wallet_reservations
      SET status = 'released',
          settled_at = now()
      WHERE request_id = $1
    `, [requestId]);

    await client.query('COMMIT');
    return normalizeAiWalletRow(rows[0]) ?? {
      userId,
      balanceUsd: roundUsdAmount(AI_INITIAL_BALANCE_USD),
      totalChargedUsd: 0,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

async function finalizeAiUsageCharge({
  requestId,
  userId,
  conversationId,
  provider,
  model,
  usage,
  pricing,
  charge,
}) {
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await ensureAiWalletExists(client, userId);

    const existingUsageRecord = await readAiUsageRecordByRequestId(client, requestId);

    if (existingUsageRecord) {
      const wallet = await getWalletSnapshot(client, userId);
      await client.query('COMMIT');
      return {
        balanceUsd: wallet.balanceUsd,
        totalChargedUsd: wallet.totalChargedUsd,
      };
    }

    const reservation = await readAiWalletReservationForUpdate(client, requestId);

    if (!reservation || reservation.status !== 'reserved') {
      throw new Error('AI 计费预留不存在或已结束，无法完成本次结算。');
    }

    if (reservation.userId !== userId) {
      throw new Error('AI 计费预留记录的用户身份不匹配。');
    }

    const refundUsd = roundUsdAmount(Math.max(reservation.reservedUsd - charge.totalCostUsd, 0));
    const extraChargeUsd = roundUsdAmount(Math.max(charge.totalCostUsd - reservation.reservedUsd, 0));

    const { rows } = await client.query(`
      UPDATE ai_user_wallets
      SET balance_usd = GREATEST(balance_usd + $2 - $3, 0),
          total_charged_usd = total_charged_usd + $4,
          updated_at = now()
      WHERE user_id = $1
      RETURNING user_id, balance_usd, total_charged_usd
    `, [userId, refundUsd, extraChargeUsd, charge.totalCostUsd]);

    await client.query(`
      INSERT INTO ai_usage_records (
        request_id,
        user_id,
        conversation_id,
        provider,
        model,
        prompt_tokens,
        cached_prompt_tokens,
        completion_tokens,
        reasoning_tokens,
        total_tokens,
        input_price_per_million_usd,
        cached_input_price_per_million_usd,
        output_price_per_million_usd,
        input_cost_usd,
        output_cost_usd,
        total_cost_usd,
        currency
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, 'USD'
      )
    `, [
      requestId,
      userId,
      conversationId || null,
      provider,
      model,
      usage.promptTokens,
      usage.cachedPromptTokens,
      usage.completionTokens,
      usage.reasoningTokens,
      usage.totalTokens,
      pricing.inputPerMillionUsd,
      pricing.cachedInputPerMillionUsd,
      pricing.outputPerMillionUsd,
      charge.inputCostUsd,
      charge.outputCostUsd,
      charge.totalCostUsd,
    ]);

    await client.query(`
      UPDATE ai_wallet_reservations
      SET status = 'charged',
          settled_at = now()
      WHERE request_id = $1
    `, [requestId]);

    await client.query('COMMIT');

    const wallet = normalizeAiWalletRow(rows[0]) ?? {
      userId,
      balanceUsd: 0,
      totalChargedUsd: roundUsdAmount(charge.totalCostUsd),
    };

    return {
      balanceUsd: wallet.balanceUsd,
      totalChargedUsd: wallet.totalChargedUsd,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

async function getAiBillingSummary(userId) {
  const pool = getDatabasePool();
  await ensureAiWalletExists(pool, userId);

  const [wallet, usageTotalsResult, modelSummaryResult, recentUsageResult] = await Promise.all([
    getWalletSnapshot(pool, userId),
    pool.query(`
      SELECT
        COUNT(*) AS request_count,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
      FROM ai_usage_records
      WHERE user_id = $1
    `, [userId]),
    pool.query(`
      SELECT
        model,
        COUNT(*) AS request_count,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd,
        MAX(created_at) AS last_used_at
      FROM ai_usage_records
      WHERE user_id = $1
      GROUP BY model
      ORDER BY MAX(created_at) DESC, model ASC
    `, [userId]),
    pool.query(`
      SELECT
        request_id,
        user_id,
        conversation_id,
        provider,
        model,
        prompt_tokens,
        cached_prompt_tokens,
        completion_tokens,
        reasoning_tokens,
        total_tokens,
        input_cost_usd,
        output_cost_usd,
        total_cost_usd,
        currency,
        created_at
      FROM ai_usage_records
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 20
    `, [userId]),
  ]);

  const usageTotalsRow = usageTotalsResult.rows[0] ?? {};
  const modelSummaries = modelSummaryResult.rows
    .map(normalizeAiBillingModelRow)
    .filter(Boolean);
  const recentUsage = recentUsageResult.rows
    .map(normalizeAiUsageRecordRow)
    .filter(Boolean);

  return {
    userId,
    currency: 'USD',
    balanceUsd: formatUsdAmount(wallet.balanceUsd),
    totalChargedUsd: formatUsdAmount(wallet.totalChargedUsd),
    totalRequests: normalizeNonNegativeInteger(usageTotalsRow.request_count, 0),
    totalTokens: normalizeNonNegativeInteger(usageTotalsRow.total_tokens, 0),
    totalCostUsd: formatUsdAmount(usageTotalsRow.total_cost_usd),
    models: modelSummaries,
    recentUsage,
  };
}

async function getAiUsageStatistics({ userLimit, topLimit }) {
  const pool = getDatabasePool();
  const [
    totalsResult,
    userSummaryResult,
    topUsersByTokensResult,
    modelSummaryResult,
    dailyTrendResult,
    weeklyTrendResult,
    monthlyTrendResult,
  ] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) AS request_count,
        COUNT(DISTINCT user_id) AS active_user_count,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
      FROM ai_usage_records
    `),
    pool.query(`
      SELECT
        u.id::text AS user_id,
        u.email,
        u.display_name,
        COUNT(r.id) AS request_count,
        COALESCE(SUM(r.total_tokens), 0) AS total_tokens,
        COALESCE(SUM(r.total_cost_usd), 0) AS total_cost_usd,
        MAX(r.created_at) AS last_used_at
      FROM auth_users AS u
      LEFT JOIN ai_usage_records AS r ON r.user_id = u.id::text
      GROUP BY u.id, u.email, u.display_name
      ORDER BY COALESCE(SUM(r.total_cost_usd), 0) DESC,
               COALESCE(SUM(r.total_tokens), 0) DESC,
               u.id ASC
      LIMIT $1
    `, [userLimit]),
    pool.query(`
      SELECT
        u.id::text AS user_id,
        u.email,
        u.display_name,
        COUNT(r.id) AS request_count,
        COALESCE(SUM(r.total_tokens), 0) AS total_tokens,
        COALESCE(SUM(r.total_cost_usd), 0) AS total_cost_usd,
        MAX(r.created_at) AS last_used_at
      FROM auth_users AS u
      INNER JOIN ai_usage_records AS r ON r.user_id = u.id::text
      GROUP BY u.id, u.email, u.display_name
      ORDER BY COALESCE(SUM(r.total_tokens), 0) DESC,
               COALESCE(SUM(r.total_cost_usd), 0) DESC,
               u.id ASC
      LIMIT $1
    `, [topLimit]),
    pool.query(`
      SELECT
        model,
        COUNT(*) AS request_count,
        COUNT(DISTINCT user_id) AS active_user_count,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd,
        MAX(created_at) AS last_used_at
      FROM ai_usage_records
      GROUP BY model
      ORDER BY total_cost_usd DESC, total_tokens DESC, model ASC
    `),
    readAiUsageTrend(pool, 'day', 30),
    readAiUsageTrend(pool, 'week', 12),
    readAiUsageTrend(pool, 'month', 12),
  ]);

  const totalsRow = totalsResult.rows[0] ?? {};
  const users = userSummaryResult.rows
    .map(normalizeAiStatisticsUserRow)
    .filter(Boolean);
  const models = modelSummaryResult.rows
    .map(normalizeAiStatisticsModelRow)
    .filter(Boolean);
  const modelsByTokens = [...models].sort(compareUsageByTokens);
  const usersByTokens = topUsersByTokensResult.rows
    .map(normalizeAiStatisticsUserRow)
    .filter(Boolean);

  return {
    generatedAt: new Date().toISOString(),
    currency: 'USD',
    totals: {
      activeUsers: normalizeNonNegativeInteger(totalsRow.active_user_count, 0),
      requests: normalizeNonNegativeInteger(totalsRow.request_count, 0),
      tokens: normalizeNonNegativeInteger(totalsRow.total_tokens, 0),
      costUsd: formatUsdAmount(totalsRow.total_cost_usd),
    },
    users,
    models,
    modelHighlights: {
      mostTokens: modelsByTokens[0] ?? null,
      highestCost: models[0] ?? null,
    },
    trends: {
      daily: dailyTrendResult.rows.map(normalizeAiStatisticsTrendRow).filter(Boolean),
      weekly: weeklyTrendResult.rows.map(normalizeAiStatisticsTrendRow).filter(Boolean),
      monthly: monthlyTrendResult.rows.map(normalizeAiStatisticsTrendRow).filter(Boolean),
    },
    top: {
      usersByCost: users.slice(0, topLimit),
      usersByTokens,
      modelsByCost: models.slice(0, topLimit),
      modelsByTokens: modelsByTokens.slice(0, topLimit),
    },
  };
}

function readAiUsageTrend(pool, granularity, periodCount) {
  const trendConfig = {
    day: { step: '1 day', lookback: periodCount - 1 },
    week: { step: '1 week', lookback: periodCount - 1 },
    month: { step: '1 month', lookback: periodCount - 1 },
  }[granularity];

  if (!trendConfig) {
    throw new Error('不支持的 AI 用量趋势粒度。');
  }

  return pool.query(`
    WITH periods AS (
      SELECT generate_series(
        date_trunc('${granularity}', now()) - interval '${trendConfig.lookback} ${granularity}',
        date_trunc('${granularity}', now()),
        interval '${trendConfig.step}'
      ) AS period_start
    ),
    usage_by_period AS (
      SELECT
        date_trunc('${granularity}', created_at) AS period_start,
        COUNT(*) AS request_count,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
      FROM ai_usage_records
      WHERE created_at >= date_trunc('${granularity}', now())
        - interval '${trendConfig.lookback} ${granularity}'
      GROUP BY date_trunc('${granularity}', created_at)
    )
    SELECT
      periods.period_start,
      COALESCE(usage_by_period.request_count, 0) AS request_count,
      COALESCE(usage_by_period.total_tokens, 0) AS total_tokens,
      COALESCE(usage_by_period.total_cost_usd, 0) AS total_cost_usd
    FROM periods
    LEFT JOIN usage_by_period USING (period_start)
    ORDER BY periods.period_start ASC
  `);
}

function normalizeAiStatisticsUserRow(row) {
  if (!row || typeof row !== 'object' || typeof row.user_id !== 'string') {
    return null;
  }

  return {
    userId: row.user_id,
    email: normalizeAuthEmail(row.email),
    displayName: typeof row.display_name === 'string' ? row.display_name : '',
    requestCount: normalizeNonNegativeInteger(row.request_count, 0),
    totalTokens: normalizeNonNegativeInteger(row.total_tokens, 0),
    totalCostUsd: formatUsdAmount(row.total_cost_usd),
    lastUsedAt: row.last_used_at
      ? normalizeIsoString(row.last_used_at, new Date().toISOString())
      : null,
  };
}

function normalizeAiStatisticsModelRow(row) {
  const modelSummary = normalizeAiBillingModelRow(row);

  if (!modelSummary) {
    return null;
  }

  return {
    ...modelSummary,
    activeUsers: normalizeNonNegativeInteger(row.active_user_count, 0),
  };
}

function normalizeAiStatisticsTrendRow(row) {
  if (!row || typeof row !== 'object' || !row.period_start) {
    return null;
  }

  return {
    periodStart: normalizeIsoString(row.period_start, new Date().toISOString()),
    requestCount: normalizeNonNegativeInteger(row.request_count, 0),
    totalTokens: normalizeNonNegativeInteger(row.total_tokens, 0),
    totalCostUsd: formatUsdAmount(row.total_cost_usd),
  };
}

function compareUsageByTokens(left, right) {
  return right.totalTokens - left.totalTokens
    || Number(right.totalCostUsd) - Number(left.totalCostUsd);
}

async function issueEmailVerificationCode(email, purpose) {
  const verification = await createEmailVerificationCode(email, purpose);

  if (!isBrevoSmtpConfigured()) {
    if (!AUTH_RETURN_DEBUG_VERIFICATION_CODE) {
      warnMissingBrevoSmtpConfigOnce();
      await deleteEmailVerificationCode(verification.id).catch(() => null);
      throw new RequestValidationError('当前服务端未配置验证码邮件发送能力，请联系管理员。', 503);
    }

    return {
      message: '验证码已生成，当前为调试模式。',
      debugCode: verification.code,
      expiresAt: verification.expiresAt,
    };
  }

  try {
    await sendRegisterVerificationEmail({
      email,
      verificationCode: verification.code,
    });
  } catch (error) {
    await deleteEmailVerificationCode(verification.id).catch(() => null);
    console.error('Failed to send verification email:', error);
    throw new RequestValidationError('验证码发送失败，请稍后重试。', 502);
  }

  return {
    message: '验证码已发送至邮箱，10 分钟内有效。',
    debugCode: AUTH_RETURN_DEBUG_VERIFICATION_CODE ? verification.code : '',
    expiresAt: verification.expiresAt,
  };
}

async function createEmailVerificationCode(email, purpose) {
  const pool = getDatabasePool();
  const client = await pool.connect();
  const verificationCode = String(normalizeNonNegativeInteger(Math.floor(Math.random() * 1_000_000), 0))
    .padStart(6, '0');
  const codeHash = createPasswordHash(verificationCode);
  const expiresAt = new Date(Date.now() + AUTH_VERIFICATION_CODE_TTL_MS).toISOString();

  try {
    await client.query('BEGIN');
    await client.query(`
      SELECT pg_advisory_xact_lock(hashtext($1))
    `, [`auth-verification:${purpose}:${email}`]);

    const latestVerificationResult = await client.query(`
      SELECT
        id,
        email,
        purpose,
        code_hash,
        expires_at,
        used_at,
        created_at
      FROM auth_email_verification_codes
      WHERE email = $1 AND purpose = $2
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `, [email, purpose]);

    const latestVerification = normalizeVerificationRow(latestVerificationResult.rows[0]);

    if (latestVerification) {
      const retryAfterSeconds = getVerificationCodeRetryAfterSeconds(latestVerification.createdAt);

      if (retryAfterSeconds > 0) {
        throw new RequestValidationError(
          `验证码发送过于频繁，请在 ${retryAfterSeconds} 秒后重试。`,
          429,
          { retryAfterSeconds }
        );
      }
    }

    const { rows } = await client.query(`
      INSERT INTO auth_email_verification_codes (
        email,
        purpose,
        code_hash,
        expires_at
      )
      VALUES ($1, $2, $3, $4::timestamptz)
      RETURNING id
    `, [email, purpose, codeHash, expiresAt]);

    await client.query('COMMIT');

    return {
      id: normalizeNonNegativeInteger(rows[0]?.id, 0),
      code: verificationCode,
      expiresAt,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

async function deleteEmailVerificationCode(id) {
  const normalizedId = normalizeNonNegativeInteger(id, 0);

  if (normalizedId <= 0) {
    return;
  }

  const pool = getDatabasePool();
  await pool.query(`
    DELETE FROM auth_email_verification_codes
    WHERE id = $1
  `, [normalizedId]);
}

function isBrevoSmtpConfigured() {
  return Boolean(BREVO_SMTP_USER && BREVO_SMTP_KEY && BREVO_SMTP_FROM_EMAIL);
}

function warnMissingBrevoSmtpConfigOnce() {
  if (hasLoggedBrevoSmtpConfigWarning) {
    return;
  }

  const missingKeys = [];

  if (!BREVO_SMTP_USER) {
    missingKeys.push('BREVO_SMTP_USER');
  }

  if (!BREVO_SMTP_KEY) {
    missingKeys.push('BREVO_SMTP_KEY');
  }

  if (!BREVO_SMTP_FROM_EMAIL) {
    missingKeys.push('BREVO_SMTP_FROM_EMAIL');
  }

  console.warn(`Brevo SMTP is not fully configured. Missing env: ${missingKeys.join(', ')}`);
  hasLoggedBrevoSmtpConfigWarning = true;
}

function getBrevoSmtpTransporter() {
  if (!isBrevoSmtpConfigured()) {
    return null;
  }

  if (!brevoSmtpTransporter) {
    brevoSmtpTransporter = nodemailer.createTransport({
      host: BREVO_SMTP_HOST,
      port: BREVO_SMTP_PORT,
      secure: BREVO_SMTP_PORT === 465,
      auth: {
        user: BREVO_SMTP_USER,
        pass: BREVO_SMTP_KEY,
      },
    });
  }

  return brevoSmtpTransporter;
}

async function sendRegisterVerificationEmail({
  email,
  verificationCode,
}) {
  const transporter = getBrevoSmtpTransporter();

  if (!transporter) {
    throw new Error('Brevo SMTP transporter is unavailable.');
  }

  const result = await transporter.sendMail({
    from: {
      name: BREVO_SMTP_FROM_NAME,
      address: BREVO_SMTP_FROM_EMAIL,
    },
    to: email,
    subject: 'Astesia 注册验证码',
    text: buildRegisterVerificationEmailText(verificationCode),
    html: buildRegisterVerificationEmailHtml(verificationCode),
  });

  if (Array.isArray(result.rejected) && result.rejected.length > 0) {
    throw new Error(`Brevo SMTP rejected recipients: ${result.rejected.join(', ')}`);
  }
}

function buildRegisterVerificationEmailText(verificationCode) {
  return [
    '你好，',
    '',
    '你正在注册 Astesia。',
    '',
    `本次验证码：${verificationCode}`,
    '验证码 10 分钟内有效。',
    '',
    '如果这不是你的操作，请直接忽略此邮件。',
  ].join('\n');
}

function buildRegisterVerificationEmailHtml(verificationCode) {
  const escapedCode = escapeHtml(verificationCode);

  return `
    <div style="margin:0;padding:24px;background:#f5f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2937;">
      <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:20px;padding:32px;box-shadow:0 12px 32px rgba(15,23,42,0.08);">
        <div style="font-size:24px;font-weight:700;color:#111827;">Astesia</div>
        <div style="margin-top:12px;font-size:16px;line-height:1.7;">
          你正在注册 Astesia，下面是本次操作的验证码：
        </div>
        <div style="margin-top:24px;padding:16px 20px;border-radius:16px;background:#eef2ff;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:#312e81;">
          ${escapedCode}
        </div>
        <div style="margin-top:20px;font-size:14px;line-height:1.8;color:#4b5563;">
          验证码 10 分钟内有效。若这不是你的操作，请直接忽略此邮件。
        </div>
      </div>
    </div>
  `.trim();
}

async function registerAuthUser({
  email,
  verificationCode,
  password,
  displayName,
}) {
  const pool = getDatabasePool();
  const existingUser = await readAuthUserByEmail(email);

  if (existingUser) {
    throw new RequestValidationError('该邮箱已注册，请直接使用邮箱和密码登录。', 409);
  }

  const verificationRecord = await readLatestVerificationCode(email, AUTH_REGISTER_CODE_PURPOSE);

  if (!verificationRecord) {
    throw new RequestValidationError('请先获取验证码。');
  }

  if (verificationRecord.usedAt) {
    throw new RequestValidationError('该验证码已使用，请重新获取。');
  }

  if (Date.now() > new Date(verificationRecord.expiresAt).getTime()) {
    throw new RequestValidationError('验证码已过期，请重新获取。');
  }

  if (!verifyPasswordHash(verificationCode, verificationRecord.codeHash)) {
    throw new RequestValidationError('验证码不正确，请重新输入。');
  }

  const passwordHash = createPasswordHash(password);
  const normalizedDisplayName = sanitizeDisplayName(displayName, email);

  const { rows } = await pool.query(`
    INSERT INTO auth_users (
      email,
      password_hash,
      display_name,
      role,
      plan_name,
      signature
    )
    VALUES ($1, $2, $3, 'user', $4, $5)
    RETURNING id, email, display_name, role, plan_name, signature, avatar_url, created_at
  `, [email, passwordHash, normalizedDisplayName, AUTH_DEFAULT_PLAN_NAME, AUTH_DEFAULT_SIGNATURE]);

  await pool.query(`
    UPDATE auth_email_verification_codes
    SET used_at = now()
    WHERE id = $1
  `, [verificationRecord.id]);

  return normalizeAuthUserRow(rows[0]);
}

async function loginAuthUser({ email, password }) {
  const user = await readAuthUserByEmail(email);

  if (!user || !verifyPasswordHash(password, user.passwordHash)) {
    throw new RequestValidationError('邮箱或密码不正确。', 401);
  }

  return user;
}

async function readAuthUserByEmail(email) {
  const pool = getDatabasePool();
  const { rows } = await pool.query(`
    SELECT
      id,
      email,
      password_hash,
      display_name,
      role,
      plan_name,
      signature,
      avatar_url,
      created_at
    FROM auth_users
    WHERE email = $1
    LIMIT 1
  `, [email]);

  return normalizeAuthUserRow(rows[0]);
}

async function readAuthUserById(userId) {
  const pool = getDatabasePool();
  const { rows } = await pool.query(`
    SELECT
      id,
      email,
      password_hash,
      display_name,
      role,
      plan_name,
      signature,
      avatar_url,
      created_at
    FROM auth_users
    WHERE id::text = $1
    LIMIT 1
  `, [userId]);

  return normalizeAuthUserRow(rows[0]);
}

async function readLatestVerificationCode(email, purpose) {
  const pool = getDatabasePool();
  const { rows } = await pool.query(`
    SELECT
      id,
      email,
      purpose,
      code_hash,
      expires_at,
      used_at,
      created_at
    FROM auth_email_verification_codes
    WHERE email = $1 AND purpose = $2
    ORDER BY created_at DESC
    LIMIT 1
  `, [email, purpose]);

  return normalizeVerificationRow(rows[0]);
}

function normalizeAuthUserRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const normalizedUserId = normalizeAiUserId(String(row.id ?? ''));
  const normalizedEmail = normalizeAuthEmail(row.email);

  if (!normalizedUserId || !normalizedEmail) {
    return null;
  }

  return {
    userId: normalizedUserId,
    email: normalizedEmail,
    passwordHash: typeof row.password_hash === 'string' ? row.password_hash : '',
    name: sanitizeDisplayName(row.display_name, normalizedEmail),
    role: typeof row.role === 'string' && row.role.trim() ? row.role.trim() : 'user',
    planName: normalizeAuthPlanName(row.plan_name),
    signature: typeof row.signature === 'string' && row.signature.trim() ? row.signature.trim() : AUTH_DEFAULT_SIGNATURE,
    avatarUrl: typeof row.avatar_url === 'string' && row.avatar_url.trim() ? row.avatar_url.trim() : null,
    createdAt: normalizeIsoString(row.created_at, new Date().toISOString()),
  };
}

function normalizeVerificationRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  return {
    id: normalizeNonNegativeInteger(row.id, 0),
    email: normalizeAuthEmail(row.email),
    purpose: typeof row.purpose === 'string' ? row.purpose : '',
    codeHash: typeof row.code_hash === 'string' ? row.code_hash : '',
    expiresAt: normalizeIsoString(row.expires_at, new Date().toISOString()),
    usedAt: row.used_at ? normalizeIsoString(row.used_at, new Date().toISOString()) : '',
    createdAt: normalizeIsoString(row.created_at, new Date().toISOString()),
  };
}

function buildAuthSuccessResponse(user) {
  if (!user) {
    throw new RequestValidationError('用户信息生成失败，请稍后重试。', 500);
  }

  return {
    token: createAuthToken(user),
    user: {
      userId: user.userId,
      name: user.name,
      email: user.email,
      role: user.role,
      planName: user.planName,
      signature: user.signature,
      avatarUrl: user.avatarUrl,
    },
  };
}

function createAuthToken(user) {
  const header = encodeBase64Url(JSON.stringify({
    alg: 'HS256',
    typ: 'JWT',
  }));
  const payload = encodeBase64Url(JSON.stringify({
    userId: user.userId,
    email: user.email,
    role: user.role,
    planName: user.planName,
    iss: AUTH_TOKEN_ISSUER,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + AUTH_TOKEN_TTL_SECONDS,
  }));
  const unsignedToken = `${header}.${payload}`;

  return `${unsignedToken}.${createAuthTokenSignature(unsignedToken)}`;
}

function normalizeAuthEmail(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalizedValue = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedValue)
    ? normalizedValue
    : '';
}

function normalizeAuthPlanName(value) {
  if (typeof value !== 'string') {
    return AUTH_DEFAULT_PLAN_NAME;
  }

  const normalizedPlanName = value.trim();

  if (!normalizedPlanName) {
    return AUTH_DEFAULT_PLAN_NAME;
  }

  return normalizedPlanName.toLowerCase() === 'free'
    ? AUTH_DEFAULT_PLAN_NAME
    : normalizedPlanName;
}

function normalizeVerificationCode(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalizedValue = value.trim();
  return /^\d{6}$/.test(normalizedValue) ? normalizedValue : '';
}

function normalizeAuthPassword(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalizedValue = value.trim();
  return normalizedValue.length >= 6 ? normalizedValue : '';
}

function createPasswordHash(value) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(value, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function createAuthTokenSignature(value) {
  return createHmac('sha256', AUTH_TOKEN_SECRET)
    .update(value)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function safeEqualSignature(currentSignature, expectedSignature) {
  if (typeof currentSignature !== 'string' || !currentSignature || !expectedSignature) {
    return false;
  }

  const currentBuffer = Buffer.from(currentSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  return currentBuffer.length === expectedBuffer.length
    && timingSafeEqual(currentBuffer, expectedBuffer);
}

function verifyPasswordHash(value, storedHash) {
  if (typeof storedHash !== 'string' || !storedHash.includes(':')) {
    return false;
  }

  const [salt, hash] = storedHash.split(':');

  if (!salt || !hash) {
    return false;
  }

  const calculatedHash = scryptSync(value, salt, 64);
  const expectedHash = Buffer.from(hash, 'hex');

  return expectedHash.length === calculatedHash.length
    && timingSafeEqual(expectedHash, calculatedHash);
}

function sanitizeDisplayName(value, fallbackEmail = '') {
  if (typeof value !== 'string') {
    return fallbackEmail ? fallbackEmail.split('@')[0] || 'Astesia 用户' : 'Astesia 用户';
  }

  const normalizedValue = value.trim().slice(0, 24);
  return normalizedValue || (fallbackEmail.split('@')[0] || 'Astesia 用户');
}

function escapeHtml(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function readConversations(userId) {
  const pool = getDatabasePool();
  const { rows } = await pool.query(`
    SELECT id, title, messages, created_at, updated_at, title_generated_at
    FROM ai_conversations
    WHERE user_id = $1
    ORDER BY updated_at DESC
  `, [userId]);

  return rows.map(normalizeConversationRow).filter(Boolean);
}

async function upsertConversation(userId, conversation) {
  const pool = getDatabasePool();
  const { rows } = await pool.query(`
    INSERT INTO ai_conversations (
      id,
      user_id,
      title,
      messages,
      created_at,
      updated_at,
      title_generated_at
    )
    VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, $6::timestamptz, $7::timestamptz)
    ON CONFLICT (id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      title = EXCLUDED.title,
      messages = EXCLUDED.messages,
      created_at = LEAST(ai_conversations.created_at, EXCLUDED.created_at),
      updated_at = EXCLUDED.updated_at,
      title_generated_at = EXCLUDED.title_generated_at
    WHERE (
      ai_conversations.user_id = EXCLUDED.user_id
      OR ai_conversations.user_id IS NULL
    )
      AND EXCLUDED.updated_at >= ai_conversations.updated_at
    RETURNING id, title, messages, created_at, updated_at, title_generated_at
  `, [
    conversation.id,
    userId,
    conversation.title,
    JSON.stringify(conversation.messages),
    conversation.createdAt,
    conversation.updatedAt,
    conversation.titleGeneratedAt ?? null,
  ]);

  if (rows[0]) {
    return normalizeConversationRow(rows[0]) ?? conversation;
  }

  const existingConversation = await readConversationById(userId, conversation.id);

  if (existingConversation) {
    return existingConversation;
  }

  throw new Error('多轮对话 id 已被其他用户占用，请重新创建会话。');
}

async function readConversationById(userId, conversationId) {
  const pool = getDatabasePool();
  const { rows } = await pool.query(`
    SELECT id, title, messages, created_at, updated_at, title_generated_at
    FROM ai_conversations
    WHERE id = $1
      AND user_id = $2
  `, [conversationId, userId]);

  return rows[0] ? normalizeConversationRow(rows[0]) : null;
}

async function deleteConversation(userId, conversationId) {
  const pool = getDatabasePool();
  await pool.query(`
    DELETE FROM ai_conversations
    WHERE id = $1
      AND user_id = $2
  `, [conversationId, userId]);
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
    return null;
  }

  const route = typeof value.route === 'string' ? value.route : 'unknown';
  const summary = typeof value.summary === 'string' ? value.summary.trim() : '';

  if (!summary) {
    return null;
  }

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
      providerName: 'DeepSeek',
      url: DEEPSEEK_URL,
    };
  }

  return {
    apiKey: getEnvValue('NITRO_ROUTER_API_KEY'),
    apiKeyName: 'NITRO_ROUTER_API_KEY',
    providerName: 'Nitro Router',
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

function getErrorStatus(error) {
  if (typeof error?.status === 'number' && Number.isInteger(error.status)) {
    return error.status;
  }

  if (error instanceof AiAuthenticationError) {
    return 401;
  }

  return 500;
}

function getRetryAfterSeconds(error) {
  const retryAfterSeconds = Number(error?.retryAfterSeconds);

  if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
    return undefined;
  }

  return Math.ceil(retryAfterSeconds);
}

function getVerificationCodeRetryAfterSeconds(createdAt) {
  const createdAtMs = new Date(createdAt).getTime();

  if (!Number.isFinite(createdAtMs)) {
    return 0;
  }

  const retryAfterMs = createdAtMs + AUTH_VERIFICATION_CODE_THROTTLE_MS - Date.now();

  return retryAfterMs > 0
    ? Math.ceil(retryAfterMs / 1000)
    : 0;
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
  hostname: HOST,
  port: PORT,
});

console.log(`AI server is running on http://${HOST}:${PORT}`);
