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

-- 仅为缺失钱包的用户补齐初始余额。
-- 已有钱包可能包含充值或人工调额，迁移不得根据默认额度重算 balance_usd。
