ALTER TABLE ai_conversations
  ADD COLUMN IF NOT EXISTS branches JSONB
    CHECK (branches IS NULL OR jsonb_typeof(branches) = 'array'),
  ADD COLUMN IF NOT EXISTS active_branch_id TEXT;
