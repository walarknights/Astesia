ALTER TABLE auth_users
  ADD COLUMN IF NOT EXISTS quota_limit_usd NUMERIC(20, 8);

UPDATE auth_users AS users
SET quota_limit_usd = COALESCE(
      (
        SELECT
          wallets.balance_usd
            + wallets.total_charged_usd
            + COALESCE(
              (
                SELECT SUM(reservations.reserved_usd)
                FROM ai_wallet_reservations AS reservations
                WHERE reservations.user_id = wallets.user_id
                  AND reservations.status = 'reserved'
              ),
              0
            )
        FROM ai_user_wallets AS wallets
        WHERE wallets.user_id = users.id::text
      ),
      1
    ),
    updated_at = now()
WHERE users.quota_limit_usd IS NULL;

ALTER TABLE auth_users
  ALTER COLUMN quota_limit_usd SET DEFAULT 1,
  ALTER COLUMN quota_limit_usd SET NOT NULL;

ALTER TABLE auth_users
  DROP CONSTRAINT IF EXISTS auth_users_quota_limit_usd_check;

ALTER TABLE auth_users
  ADD CONSTRAINT auth_users_quota_limit_usd_check
  CHECK (quota_limit_usd >= 0);

CREATE INDEX IF NOT EXISTS auth_users_email_lower_idx
  ON auth_users (LOWER(email));

CREATE INDEX IF NOT EXISTS auth_users_display_name_lower_idx
  ON auth_users (LOWER(display_name));

CREATE TABLE IF NOT EXISTS ai_model_controls (
  model TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_model_controls_enabled_idx
  ON ai_model_controls (enabled, model);
