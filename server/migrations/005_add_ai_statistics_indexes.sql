CREATE INDEX IF NOT EXISTS ai_usage_records_created_at_idx
  ON ai_usage_records (created_at DESC);

CREATE INDEX IF NOT EXISTS ai_usage_records_model_created_at_idx
  ON ai_usage_records (model, created_at DESC);
