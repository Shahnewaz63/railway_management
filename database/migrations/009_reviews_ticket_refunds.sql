ALTER TABLE ticket
  ADD COLUMN IF NOT EXISTS ticket_status VARCHAR(20) NOT NULL DEFAULT 'active'
  CHECK (ticket_status IN ('active', 'cancelled'));

CREATE TABLE IF NOT EXISTS ticket_refund (
  refund_id    SERIAL PRIMARY KEY,
  ticket_id    INT NOT NULL UNIQUE REFERENCES ticket(ticket_id) ON DELETE CASCADE,
  payment_id   INT REFERENCES payment(payment_id) ON DELETE SET NULL,
  amount       NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  refund_status VARCHAR(20) NOT NULL DEFAULT 'processed' CHECK (refund_status IN ('processed')),
  processed_at TIMESTAMP(6) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS train_review (
  review_id   SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  train_id    INT NOT NULL REFERENCES train(train_id) ON DELETE CASCADE,
  route_id    INT NOT NULL REFERENCES route(route_id) ON DELETE CASCADE,
  rating      INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     VARCHAR(1000) NOT NULL,
  created_at  TIMESTAMP(6) NOT NULL DEFAULT now(),
  UNIQUE (user_id, train_id, route_id)
);
CREATE INDEX IF NOT EXISTS idx_train_review_route ON train_review (train_id, route_id, created_at DESC);
