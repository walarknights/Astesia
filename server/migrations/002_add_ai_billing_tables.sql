ALTER TABLE ai_conversations
  ADD COLUMN IF NOT EXISTS user_id TEXT;

CREATE INDEX IF NOT EXISTS ai_conversations_user_id_updated_at_idx
  ON ai_conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_user_wallets (
  user_id TEXT PRIMARY KEY,
  balance_usd NUMERIC(20, 8) NOT NULL DEFAULT 0,
  total_charged_usd NUMERIC(20, 8) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_wallet_reservations (
  request_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  reserved_usd NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'released', 'charged')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ai_wallet_reservations_user_id_created_at_idx
  ON ai_wallet_reservations (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_usage_records (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  conversation_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  cached_prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  reasoning_tokens INTEGER NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
  total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  input_price_per_million_usd NUMERIC(20, 8) NOT NULL DEFAULT 0,
  cached_input_price_per_million_usd NUMERIC(20, 8) NOT NULL DEFAULT 0,
  output_price_per_million_usd NUMERIC(20, 8) NOT NULL DEFAULT 0,
  input_cost_usd NUMERIC(20, 8) NOT NULL DEFAULT 0,
  output_cost_usd NUMERIC(20, 8) NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(20, 8) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_usage_records_user_id_created_at_idx
  ON ai_usage_records (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_usage_records_user_id_model_created_at_idx
  ON ai_usage_records (user_id, model, created_at DESC);
