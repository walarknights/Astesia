import { existsSync, readdirSync, readFileSync } from 'node:fs';

import pg from 'pg';

import { createDatabaseSslConfig } from './database-config.mjs';

loadLocalEnv();

const { Pool } = pg;
const MIGRATIONS_DIR_URL = new URL('./migrations/', import.meta.url);
const MIGRATION_LOCK_NAME = 'astesia_schema_migrations';
const DATABASE_URL = normalizeDatabaseUrl(process.env.DATABASE_URL);

if (!DATABASE_URL) {
  console.error('缺少 DATABASE_URL，请先配置 PostgreSQL 连接串。');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: createDatabaseSslConfig(DATABASE_URL),
});

try {
  await runMigrations();
} finally {
  await pool.end();
}

async function runMigrations() {
  const client = await pool.connect();
  let hasMigrationLock = false;

  try {
    await client.query(
      'SELECT pg_advisory_lock(hashtext($1))',
      [MIGRATION_LOCK_NAME]
    );
    hasMigrationLock = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const appliedVersions = new Set(rows.map((row) => row.version));
    const migrationFiles = readdirSync(MIGRATIONS_DIR_URL)
      .filter((fileName) => fileName.endsWith('.sql'))
      .sort();

    for (const fileName of migrationFiles) {
      if (appliedVersions.has(fileName)) {
        console.log(`跳过已执行迁移: ${fileName}`);
        continue;
      }

      const sql = readFileSync(new URL(fileName, MIGRATIONS_DIR_URL), 'utf8');

      console.log(`执行迁移: ${fileName}`);
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [fileName]);
      await client.query('COMMIT');
    }

    console.log('PostgreSQL 迁移执行完成。');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => null);
    throw error;
  } finally {
    if (hasMigrationLock) {
      await client.query(
        'SELECT pg_advisory_unlock(hashtext($1))',
        [MIGRATION_LOCK_NAME]
      ).catch(() => null);
    }

    client.release();
  }
}

function normalizeDatabaseUrl(value) {
  return typeof value === 'string'
    ? value.trim().replace(/^['"]|['"]$/g, '')
    : '';
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
