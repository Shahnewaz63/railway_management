-- Enforce cross-table constraints that ordinary CHECK constraints cannot
-- express, and centralize expiration of abandoned seat holds.

CREATE OR REPLACE FUNCTION validate_ticket_journey()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  start_station VARCHAR(10);
  end_station VARCHAR(10);
  train_route_id INT;
  seat_train_id INT;
  trip_train_id INT;
  start_order INT;
  end_order INT;
BEGIN
  SELECT b.starts_at_station, b.ends_at_station, t.route_id, t.train_id,
         c.train_id
    INTO STRICT start_station, end_station, train_route_id, trip_train_id, seat_train_id
    FROM booking b
    JOIN trip t ON t.trip_id = NEW.trip_id
    JOIN seat s ON s.seat_id = NEW.seat_id
    JOIN coach c ON c.coach_id = s.coach_id
   WHERE b.pnr_number = NEW.pnr_number;

  -- Keep the seat on the train assigned to this trip.
  IF seat_train_id <> trip_train_id THEN
    RAISE EXCEPTION 'Ticket seat must belong to the train assigned to the trip'
      USING ERRCODE = '23514';
  END IF;

  -- The booking endpoints must occur on the trip route, in travel order.
  SELECT a.stop_order, z.stop_order
    INTO start_order, end_order
    FROM booking b
    JOIN route_station a ON a.route_id = train_route_id AND a.station_code = start_station
    JOIN route_station z ON z.route_id = train_route_id AND z.station_code = end_station
   WHERE b.pnr_number = NEW.pnr_number;
  IF NOT FOUND OR start_order >= end_order THEN
    RAISE EXCEPTION 'Ticket trip route must serve the booking journey in the correct direction'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ticket_journey_integrity ON ticket;
CREATE TRIGGER ticket_journey_integrity
BEFORE INSERT OR UPDATE ON ticket
FOR EACH ROW EXECUTE FUNCTION validate_ticket_journey();

CREATE OR REPLACE FUNCTION expire_pending_bookings(p_hold_minutes INT DEFAULT 5)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  expired_count INT;
BEGIN
  IF p_hold_minutes < 1 THEN
    RAISE EXCEPTION 'Hold duration must be at least one minute';
  END IF;

  UPDATE booking
     SET booking_status = 'expired'
   WHERE booking_status = 'pending'
     AND booking_date <= now() - make_interval(mins => p_hold_minutes);
  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$;

CREATE OR REPLACE PROCEDURE run_booking_maintenance(p_hold_minutes INT DEFAULT 5)
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM expire_pending_bookings(p_hold_minutes);
END;
$$;
