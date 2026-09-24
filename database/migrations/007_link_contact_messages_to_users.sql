ALTER TABLE contact_message
  ADD COLUMN user_id INT REFERENCES users(user_id) ON DELETE SET NULL;
CREATE INDEX idx_contact_message_user ON contact_message (user_id);
