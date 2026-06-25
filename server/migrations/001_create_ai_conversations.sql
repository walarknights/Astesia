CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '对话标题',
  messages JSONB NOT NULL CHECK (jsonb_typeof(messages) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  title_generated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ai_conversations_updated_at_idx
  ON ai_conversations (updated_at DESC);
