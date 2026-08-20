export function createHealthService({ getLatestMigrationVersion, getDatabasePool }) {
  return async function handleReadinessRequest(c) {
    try {
      const latestMigrationVersion = getLatestMigrationVersion();
      const pool = getDatabasePool();

      await pool.query('SELECT 1');
      const { rows } = await pool.query(
        'SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1) AS applied',
        [latestMigrationVersion]
      );

      if (rows[0]?.applied !== true) {
        throw new Error('latest migration is not applied');
      }

      return c.json({ ok: true, latestMigration: latestMigrationVersion });
    } catch (error) {
      console.error('[health] readiness check failed:', error);
      return c.json({ ok: false }, 503);
    }
  };
}
