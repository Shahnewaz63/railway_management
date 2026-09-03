ALTER TABLE route_station
  ADD CONSTRAINT route_station_stop_order_positive CHECK (stop_order > 0);

ALTER TABLE trip
  ADD CONSTRAINT trip_status_check CHECK (status IN ('scheduled', 'cancelled', 'completed'));

ALTER TABLE booking
  ADD CONSTRAINT booking_status_check CHECK (booking_status IN ('pending', 'confirmed', 'expired', 'cancelled')),
  ADD CONSTRAINT booking_fare_nonnegative CHECK (fare >= 0),
  ADD CONSTRAINT booking_distinct_stations CHECK (starts_at_station <> ends_at_station);

ALTER TABLE ticket
  ADD CONSTRAINT ticket_passenger_age_range CHECK (passenger_age BETWEEN 1 AND 120),
  ADD CONSTRAINT ticket_price_nonnegative CHECK (price >= 0);

ALTER TABLE payment
  ADD CONSTRAINT payment_amount_nonnegative CHECK (amount >= 0),
  ADD CONSTRAINT payment_method_check CHECK (payment_method IN ('bKash', 'Nagad', 'Card')),
  ADD CONSTRAINT payment_pnr_unique UNIQUE (pnr_number);
