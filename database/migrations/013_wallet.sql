-- Wallets are a simulated stored balance. Top-ups do not contact a payment
-- gateway; each operation is recorded in an append-only transaction ledger.
BEGIN;

-- Keep databases upgraded through the wallet migration compatible with the
-- server's periodic hold-expiration sweep (also defined by migration 012).
CREATE OR REPLACE PROCEDURE run_booking_maintenance(p_hold_minutes INT DEFAULT 5)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_hold_minutes < 1 THEN
    RAISE EXCEPTION 'Hold duration must be at least one minute';
  END IF;
  UPDATE booking SET booking_status = 'expired'
   WHERE booking_status = 'pending'
     AND booking_date <= now() - make_interval(mins => p_hold_minutes);
END;
$$;

CREATE TABLE IF NOT EXISTS wallet_account (
  user_id INT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_transaction (
  transaction_id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('top_up', 'purchase', 'refund', 'admin_credit')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  balance_after NUMERIC(12,2) NOT NULL CHECK (balance_after >= 0),
  payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('bKash', 'Nagad', 'Card', 'Other', 'Wallet')),
  reference_code VARCHAR(100),
  pnr_number VARCHAR(20),
  source_refund_id INT UNIQUE,
  actor_user_id INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE wallet_transaction ADD COLUMN IF NOT EXISTS actor_user_id INT REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE wallet_transaction DROP CONSTRAINT IF EXISTS wallet_transaction_transaction_type_check;
ALTER TABLE wallet_transaction ADD CONSTRAINT wallet_transaction_transaction_type_check
  CHECK (transaction_type IN ('top_up', 'purchase', 'refund', 'admin_credit'));
CREATE INDEX IF NOT EXISTS idx_wallet_transaction_user_date
  ON wallet_transaction(user_id, created_at DESC, transaction_id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_topup_reference
  ON wallet_transaction(user_id, payment_method, reference_code)
  WHERE transaction_type = 'top_up' AND reference_code IS NOT NULL;

ALTER TABLE payment DROP CONSTRAINT IF EXISTS payment_method_check;
ALTER TABLE payment DROP CONSTRAINT IF EXISTS payment_payment_method_check;
ALTER TABLE payment ADD CONSTRAINT payment_method_check
  CHECK (payment_method IN ('bKash', 'Nagad', 'Card', 'Wallet'));

CREATE OR REPLACE FUNCTION create_user_wallet()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO wallet_account(user_id) VALUES (NEW.user_id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_create_wallet ON users;
CREATE TRIGGER users_create_wallet
AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION create_user_wallet();

INSERT INTO wallet_account(user_id)
SELECT user_id FROM users ON CONFLICT (user_id) DO NOTHING;

-- Any successful cancellation path inserts a ticket_refund row. This trigger
-- credits that ticket's owner once and records the resulting wallet balance.
CREATE OR REPLACE FUNCTION credit_wallet_for_ticket_refund()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owner_id INT;
  new_balance NUMERIC(12,2);
BEGIN
  IF NEW.amount = 0 THEN
    RETURN NEW;
  END IF;
  SELECT b.user_id INTO STRICT owner_id
    FROM ticket tk JOIN booking b ON b.pnr_number = tk.pnr_number
   WHERE tk.ticket_id = NEW.ticket_id;

  INSERT INTO wallet_account(user_id) VALUES (owner_id)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE wallet_account
     SET balance = balance + NEW.amount, updated_at = now()
   WHERE user_id = owner_id
   RETURNING balance INTO new_balance;

  INSERT INTO wallet_transaction(
    user_id, transaction_type, amount, balance_after, payment_method,
    pnr_number, source_refund_id
  )
  SELECT owner_id, 'refund', NEW.amount, new_balance, 'Wallet', tk.pnr_number, NEW.refund_id
    FROM ticket tk WHERE tk.ticket_id = NEW.ticket_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ticket_refund_wallet_credit ON ticket_refund;
CREATE TRIGGER ticket_refund_wallet_credit
AFTER INSERT ON ticket_refund
FOR EACH ROW EXECUTE FUNCTION credit_wallet_for_ticket_refund();

COMMIT;
