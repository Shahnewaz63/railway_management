-- ============================================================================
-- BD Railway — database schema
-- Matches the provided ER diagram field-for-field (types, keys, relationships).
-- The only addition is `user_auth`, a separate 1:1 table for login credentials
-- — `users` itself has no password column, so this is additive, not a change
-- to the existing entity.
-- ============================================================================

CREATE TABLE station (
  station_code   VARCHAR(10)  PRIMARY KEY,
  station_name   VARCHAR(100) NOT NULL,
  city           VARCHAR(100) NOT NULL
);

CREATE TABLE route (
  route_id       SERIAL PRIMARY KEY,
  route_name     VARCHAR(100) NOT NULL
);

CREATE TABLE route_station (
  route_id       INT NOT NULL REFERENCES route(route_id) ON DELETE CASCADE,
  station_code   VARCHAR(10) NOT NULL REFERENCES station(station_code) ON DELETE CASCADE,
  stop_order     INT NOT NULL CHECK (stop_order > 0),
  PRIMARY KEY (route_id, station_code)
);

CREATE TABLE train (
  train_id       SERIAL PRIMARY KEY,
  train_name     VARCHAR(100) NOT NULL
);

-- Train-specific local arrival/departure times at every station on its route.
CREATE TABLE train_station_schedule (
  train_id       INT NOT NULL REFERENCES train(train_id) ON DELETE CASCADE,
  route_id       INT NOT NULL REFERENCES route(route_id) ON DELETE CASCADE,
  station_code   VARCHAR(10) NOT NULL,
  arrival_time   TIME NOT NULL,
  departure_time TIME NOT NULL,
  PRIMARY KEY (train_id, station_code),
  FOREIGN KEY (route_id, station_code) REFERENCES route_station(route_id, station_code) ON DELETE CASCADE
);

CREATE TABLE coach (
  coach_id       SERIAL PRIMARY KEY,
  train_id       INT NOT NULL REFERENCES train(train_id) ON DELETE CASCADE,
  coach_number   INT NOT NULL,
  coach_type     VARCHAR(50) NOT NULL,
  capacity       INT NOT NULL CHECK (capacity > 0),
  UNIQUE (train_id, coach_number)
);

CREATE TABLE seat (
  seat_id        SERIAL PRIMARY KEY,
  coach_id       INT NOT NULL REFERENCES coach(coach_id) ON DELETE CASCADE,
  seat_number    VARCHAR(10) NOT NULL,
  seat_type      VARCHAR(50) NOT NULL,
  UNIQUE (coach_id, seat_number)
);

CREATE TABLE trip (
  trip_id         SERIAL PRIMARY KEY,
  train_id        INT NOT NULL REFERENCES train(train_id) ON DELETE CASCADE,
  route_id        INT NOT NULL REFERENCES route(route_id) ON DELETE CASCADE,
  departure_date  TIMESTAMP(6) NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled', 'cancelled', 'completed'))
);

CREATE TABLE users (
  user_id        SERIAL PRIMARY KEY,
  first_name     VARCHAR(50)  NOT NULL,
  last_name      VARCHAR(50)  NOT NULL,
  email          VARCHAR(100) NOT NULL UNIQUE,
  role           VARCHAR(20)  NOT NULL DEFAULT 'customer'
                 CHECK (role IN ('customer', 'admin'))
);

-- Additive: not in the original diagram. Login cannot function without
-- somewhere to store a credential, and the brief says to add auth storage
-- only if absolutely necessary rather than alter `users` — so it lives here,
-- keyed 1:1 onto the existing table.
CREATE TABLE user_auth (
  user_id        INT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  password_hash  VARCHAR(200) NOT NULL
);

-- Server-side session records make logout an actual invalidation, rather than
-- merely asking the browser to forget a still-valid JWT.
CREATE TABLE auth_session (
  session_id      VARCHAR(36) PRIMARY KEY,
  user_id         INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  expires_at      TIMESTAMP(6) NOT NULL,
  revoked_at      TIMESTAMP(6),
  created_at      TIMESTAMP(6) NOT NULL DEFAULT now()
);
CREATE INDEX idx_auth_session_active ON auth_session (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE password_reset_otp (
  reset_id    BIGSERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  otp_hash    CHAR(64) NOT NULL,
  attempts    SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX idx_password_reset_otp_user_active
  ON password_reset_otp (user_id, created_at DESC)
  WHERE consumed_at IS NULL;

CREATE TABLE booking (
  pnr_number         VARCHAR(20) PRIMARY KEY,
  user_id            INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  starts_at_station  VARCHAR(10) NOT NULL REFERENCES station(station_code),
  ends_at_station    VARCHAR(10) NOT NULL REFERENCES station(station_code),
  booking_date       TIMESTAMP(6) NOT NULL DEFAULT now(),
  booking_status     VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (booking_status IN ('pending', 'confirmed', 'expired', 'cancelled')),
  fare               NUMERIC(10,2) NOT NULL CHECK (fare >= 0),
  CHECK (starts_at_station <> ends_at_station)
);

CREATE TABLE ticket (
  ticket_id       SERIAL PRIMARY KEY,
  pnr_number      VARCHAR(20) NOT NULL REFERENCES booking(pnr_number) ON DELETE CASCADE,
  trip_id         INT NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  seat_id         INT NOT NULL REFERENCES seat(seat_id) ON DELETE CASCADE,
  passenger_name  VARCHAR(100) NOT NULL,
  passenger_age   INT NOT NULL CHECK (passenger_age BETWEEN 1 AND 120),
  price           NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  ticket_status   VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (ticket_status IN ('active', 'cancelled'))
);

CREATE TABLE payment (
  payment_id      SERIAL PRIMARY KEY,
  pnr_number      VARCHAR(20) NOT NULL REFERENCES booking(pnr_number) ON DELETE CASCADE,
  amount          NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  payment_method  VARCHAR(50) NOT NULL CHECK (payment_method IN ('bKash', 'Nagad', 'Card')),
  UNIQUE (pnr_number)
);

CREATE TABLE ticket_refund (
  refund_id     SERIAL PRIMARY KEY,
  ticket_id     INT NOT NULL UNIQUE REFERENCES ticket(ticket_id) ON DELETE CASCADE,
  payment_id    INT REFERENCES payment(payment_id) ON DELETE SET NULL,
  amount        NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  refund_status VARCHAR(20) NOT NULL DEFAULT 'processed' CHECK (refund_status IN ('processed')),
  processed_at  TIMESTAMP(6) NOT NULL DEFAULT now()
);

CREATE TABLE train_review (
  review_id   SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  train_id    INT NOT NULL REFERENCES train(train_id) ON DELETE CASCADE,
  route_id    INT NOT NULL REFERENCES route(route_id) ON DELETE CASCADE,
  rating      INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     VARCHAR(1000) NOT NULL,
  created_at  TIMESTAMP(6) NOT NULL DEFAULT now(),
  UNIQUE (user_id, train_id, route_id)
);
CREATE INDEX idx_train_review_route ON train_review (train_id, route_id, created_at DESC);

CREATE TABLE contact_message (
  contact_id    SERIAL PRIMARY KEY,
  user_id       INT REFERENCES users(user_id) ON DELETE SET NULL,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(254) NOT NULL,
  subject       VARCHAR(150) NOT NULL,
  message       TEXT NOT NULL,
  submitted_at  TIMESTAMP(6) NOT NULL DEFAULT now()
);
CREATE INDEX idx_contact_message_date ON contact_message (submitted_at DESC);

-- Indexes that the booking/search queries lean on.
CREATE INDEX idx_ticket_trip_seat  ON ticket (trip_id, seat_id);
CREATE INDEX idx_trip_train_date   ON trip (train_id, departure_date);
CREATE INDEX idx_booking_user      ON booking (user_id);
CREATE INDEX idx_route_station_rt  ON route_station (route_id, stop_order);
