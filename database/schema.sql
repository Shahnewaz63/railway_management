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
  stop_order     INT NOT NULL,
  PRIMARY KEY (route_id, station_code)
);

CREATE TABLE train (
  train_id       SERIAL PRIMARY KEY,
  train_name     VARCHAR(100) NOT NULL
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
);

CREATE TABLE users (
  user_id        SERIAL PRIMARY KEY,
  first_name     VARCHAR(50)  NOT NULL,
  last_name      VARCHAR(50)  NOT NULL,
  email          VARCHAR(100) NOT NULL UNIQUE
);

-- Additive: not in the original diagram. Login cannot function without
-- somewhere to store a credential, and the brief says to add auth storage
-- only if absolutely necessary rather than alter `users` — so it lives here,
-- keyed 1:1 onto the existing table.
CREATE TABLE user_auth (
  user_id        INT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  password_hash  VARCHAR(200) NOT NULL
);

CREATE TABLE booking (
  pnr_number         VARCHAR(20) PRIMARY KEY,
  user_id            INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  starts_at_station  VARCHAR(10) NOT NULL REFERENCES station(station_code),
  ends_at_station    VARCHAR(10) NOT NULL REFERENCES station(station_code),
  booking_date       TIMESTAMP(6) NOT NULL DEFAULT now(),
  booking_status     VARCHAR(20) NOT NULL DEFAULT 'pending',
  fare               NUMERIC(10,2) NOT NULL
);

CREATE TABLE ticket (
  ticket_id       SERIAL PRIMARY KEY,
  pnr_number      VARCHAR(20) NOT NULL REFERENCES booking(pnr_number) ON DELETE CASCADE,
  trip_id         INT NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  seat_id         INT NOT NULL REFERENCES seat(seat_id) ON DELETE CASCADE,
  passenger_name  VARCHAR(100) NOT NULL,
  passenger_age   INT NOT NULL CHECK (passenger_age > 0),
  price           NUMERIC(10,2) NOT NULL
);

CREATE TABLE payment (
  payment_id      SERIAL PRIMARY KEY,
  pnr_number      VARCHAR(20) NOT NULL REFERENCES booking(pnr_number) ON DELETE CASCADE,
  amount          NUMERIC(10,2) NOT NULL,
  payment_method  VARCHAR(50) NOT NULL
);

-- Indexes that the booking/search queries lean on.
CREATE INDEX idx_ticket_trip_seat  ON ticket (trip_id, seat_id);
CREATE INDEX idx_trip_train_date   ON trip (train_id, departure_date);
CREATE INDEX idx_booking_user      ON booking (user_id);
CREATE INDEX idx_route_station_rt  ON route_station (route_id, stop_order);
