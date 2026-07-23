const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

export function createDatabaseSslConfig(databaseUrl) {
  if (!shouldUseDatabaseSsl(databaseUrl)) {
    return undefined;
  }

  const rejectUnauthorized = normalizeBoolean(
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED,
    true
  );
  const ca = normalizeCertificate(process.env.DATABASE_SSL_CA);

  return ca
    ? { rejectUnauthorized, ca }
    : { rejectUnauthorized };
}

function shouldUseDatabaseSsl(databaseUrl) {
  const configuredValue = normalizeBoolean(process.env.DATABASE_SSL, null);

  if (configuredValue !== null) {
    return configuredValue;
  }

  try {
    return !LOCAL_DATABASE_HOSTS.has(new URL(databaseUrl).hostname);
  } catch {
    return !/localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/.test(databaseUrl);
  }
}

function normalizeBoolean(value, fallbackValue) {
  if (typeof value !== 'string') {
    return fallbackValue;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (['true', '1', 'yes', 'on'].includes(normalizedValue)) {
    return true;
  }

  if (['false', '0', 'no', 'off'].includes(normalizedValue)) {
    return false;
  }

  return fallbackValue;
}

function normalizeCertificate(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().replace(/\\n/g, '\n')
    : undefined;
}
