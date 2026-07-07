CREATE TABLE IF NOT EXISTS auth_users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  plan_name TEXT NOT NULL DEFAULT 'Free',
  signature TEXT NOT NULL DEFAULT '欢迎来到 Astesia',
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_users_created_at_idx
  ON auth_users (created_at DESC);

CREATE TABLE IF NOT EXISTS auth_email_verification_codes (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_email_verification_codes_email_purpose_created_at_idx
  ON auth_email_verification_codes (email, purpose, created_at DESC);
