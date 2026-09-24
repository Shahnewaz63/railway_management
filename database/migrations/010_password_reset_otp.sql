CREATE TABLE IF NOT EXISTS password_reset_otp (
  reset_id    BIGSERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  otp_hash    CHAR(64) NOT NULL,
  attempts    SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_password_reset_otp_user_active
  ON password_reset_otp (user_id, created_at DESC)
  WHERE consumed_at IS NULL;
