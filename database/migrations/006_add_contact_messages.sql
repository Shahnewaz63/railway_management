CREATE TABLE contact_message (
  contact_id    SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(254) NOT NULL,
  subject       VARCHAR(150) NOT NULL,
  message       TEXT NOT NULL,
  submitted_at  TIMESTAMP(6) NOT NULL DEFAULT now()
);
CREATE INDEX idx_contact_message_date ON contact_message (submitted_at DESC);
