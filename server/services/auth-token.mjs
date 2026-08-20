import { Buffer } from 'node:buffer';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function createAuthTokenService({ secret, issuer, ttlSeconds, normalizeUserId }) {
  return {
    createAuthToken(user) {
      const header = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = encodeBase64Url(JSON.stringify({
        userId: user.userId,
        email: user.email,
        role: user.role,
        planName: user.planName,
        iss: issuer,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + ttlSeconds,
      }));
      const unsignedToken = `${header}.${payload}`;
      return `${unsignedToken}.${createAuthTokenSignature(unsignedToken, secret)}`;
    },

    extractUserIdFromBearerToken(token) {
      if (!token || token.split('.').length < 2) return '';

      try {
        const [headerSegment, payloadSegment, signatureSegment = ''] = token.split('.');
        const payload = JSON.parse(decodeBase64Url(payloadSegment));

        if (payload?.iss !== issuer) return '';
        const expectedSignature = createAuthTokenSignature(`${headerSegment}.${payloadSegment}`, secret);
        if (!safeEqualSignature(signatureSegment, expectedSignature)) return '';

        const expiresAt = Number(payload?.exp);
        if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return '';

        for (const key of ['userId', 'user_id', 'uid', 'sub']) {
          const userId = normalizeUserId(String(payload?.[key] ?? ''));
          if (userId) return userId;
        }
      } catch {
        return '';
      }

      return '';
    },

    createPasswordHash,
    verifyPasswordHash,
    normalizeAuthPassword,
    createAuthTokenSignature: (value) => createAuthTokenSignature(value, secret),
  };
}

function encodeBase64Url(value) {
  return Buffer.from(value, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const normalizedValue = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalizedValue.length % 4 === 0 ? '' : '='.repeat(4 - (normalizedValue.length % 4));
  return Buffer.from(`${normalizedValue}${padding}`, 'base64').toString('utf8');
}

function createPasswordHash(value) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(value, salt, 64).toString('hex')}`;
}

function verifyPasswordHash(value, storedHash) {
  if (typeof storedHash !== 'string' || !storedHash.includes(':')) return false;
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const calculatedHash = scryptSync(value, salt, 64);
  const expectedHash = Buffer.from(hash, 'hex');
  return expectedHash.length === calculatedHash.length && timingSafeEqual(expectedHash, calculatedHash);
}

function createAuthTokenSignature(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function safeEqualSignature(currentSignature, expectedSignature) {
  if (typeof currentSignature !== 'string' || !currentSignature || !expectedSignature) return false;
  const currentBuffer = Buffer.from(currentSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  return currentBuffer.length === expectedBuffer.length && timingSafeEqual(currentBuffer, expectedBuffer);
}

function normalizeAuthPassword(value) {
  if (typeof value !== 'string') return '';
  const normalizedValue = value.trim();
  return normalizedValue.length >= 6 ? normalizedValue : '';
}
