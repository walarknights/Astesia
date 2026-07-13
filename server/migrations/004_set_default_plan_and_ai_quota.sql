ALTER TABLE auth_users
  ALTER COLUMN plan_name SET DEFAULT '普通计划';

UPDATE auth_users
SET plan_name = '普通计划',
    updated_at = now()
WHERE plan_name IS NULL
   OR BTRIM(plan_name) = ''
   OR LOWER(BTRIM(plan_name)) = 'free';

ALTER TABLE ai_user_wallets
  ALTER COLUMN balance_usd SET DEFAULT 1;

INSERT INTO ai_user_wallets (user_id, balance_usd, total_charged_usd)
SELECT u.id::text, 1, 0
FROM auth_users AS u
WHERE NOT EXISTS (
  SELECT 1
  FROM ai_user_wallets AS wallet
  WHERE wallet.user_id = u.id::text
);

WITH reserved_totals AS (
  SELECT
    user_id,
    COALESCE(SUM(reserved_usd), 0) AS active_reserved_usd
  FROM ai_wallet_reservations
  WHERE status = 'reserved'
  GROUP BY user_id
)
UPDATE ai_user_wallets AS wallet
SET balance_usd = GREATEST(
      1::numeric
      - wallet.total_charged_usd
      - COALESCE(reserved_totals.active_reserved_usd, 0),
      0
    ),
    updated_at = now()
FROM reserved_totals
WHERE reserved_totals.user_id = wallet.user_id;

UPDATE ai_user_wallets AS wallet
SET balance_usd = GREATEST(1::numeric - wallet.total_charged_usd, 0),
    updated_at = now()
WHERE NOT EXISTS (
  SELECT 1
  FROM ai_wallet_reservations AS reservation
  WHERE reservation.user_id = wallet.user_id
    AND reservation.status = 'reserved'
);
