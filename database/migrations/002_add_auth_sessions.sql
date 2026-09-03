CREATE TABLE IF NOT EXISTS auth_session (
  session_id      VARCHAR(36) PRIMARY KEY,
  user_id         INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  expires_at      TIMESTAMP(6) NOT NULL,
  revoked_at      TIMESTAMP(6),
  created_at      TIMESTAMP(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_session_active ON auth_session (user_id, expires_at)
  WHERE revoked_at IS NULL;
