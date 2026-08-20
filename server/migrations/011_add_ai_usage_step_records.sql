-- 分步用量记录表：记录一次请求中每一步 LLM 调用的 usage 与估算成本，
-- 与 ai_usage_records（每请求一条的最终计费记录）互为补充，用于用量审计与分步成本分析。
-- 说明：request_id 非唯一（同一请求含中间步骤），成本为按单价估算，不作为实际扣费依据。
CREATE TABLE IF NOT EXISTS ai_usage_step_records (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  conversation_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  step_number INTEGER NOT NULL CHECK (step_number >= 0),
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  cached_prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  reasoning_tokens INTEGER NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
  total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  input_cost_usd NUMERIC(20, 8) NOT NULL DEFAULT 0,
  output_cost_usd NUMERIC(20, 8) NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(20, 8) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_usage_step_records_request_id_idx
  ON ai_usage_step_records (request_id);

CREATE INDEX IF NOT EXISTS ai_usage_step_records_user_id_created_at_idx
  ON ai_usage_step_records (user_id, created_at DESC);
