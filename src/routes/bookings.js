const router = require("express").Router();
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { calculateFare, HOLD_MINUTES } = require("../config/fares");
const { isPlainObject, normalizePassengerName, normalizePnr, normalizeStationCode, parsePositiveId, parsePassengerAge } = require("../lib/request-validation");

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function genPnr() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "PNR";
  for (let i = 0; i < 7; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function loadBookingFull(pnr) {
  const bRes = await pool.query("SELECT * FROM booking WHERE pnr_number = $1", [pnr]);
  if (!bRes.rowCount) return null;
  const booking = bRes.rows[0];

  const expired =
    booking.booking_status === "pending" &&
    Date.now() - new Date(booking.booking_date).getTime() >= HOLD_MINUTES * 60 * 1000;

  const ticketsRes = await pool.query(
    `SELECT tk.*, s.seat_number, c.coach_number, c.coach_type, t.departure_date, tr.train_name,
            to_char(t.departure_date::date + sf.departure_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,
            to_char(t.departure_date::date + st.arrival_time + CASE WHEN st.arrival_time < sf.departure_time THEN interval '1 day' ELSE interval '0 day' END, 'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at,
            rf.amount AS refund_amount, rf.refund_status, rf.processed_at AS refunded_at
     FROM ticket tk
     JOIN seat s ON s.seat_id = tk.seat_id
     JOIN coach c ON c.coach_id = s.coach_id
     JOIN trip t ON t.trip_id = tk.trip_id
     JOIN train tr ON tr.train_id = t.train_id
     LEFT JOIN ticket_refund rf ON rf.ticket_id = tk.ticket_id
     JOIN booking b ON b.pnr_number = tk.pnr_number
     LEFT JOIN train_station_schedule sf ON sf.train_id = t.train_id AND sf.route_id = t.route_id AND sf.station_code = b.starts_at_station
     LEFT JOIN train_station_schedule st ON st.train_id = t.train_id AND st.route_id = t.route_id AND st.station_code = b.ends_at_station
     WHERE tk.pnr_number = $1`,
    [pnr]
  );
  const payRes = await pool.query("SELECT * FROM payment WHERE pnr_number = $1", [pnr]);

  return {
    booking: { ...booking, effective_status: expired ? "expired" : booking.booking_status },
    tickets: ticketsRes.rows,
    payment: payRes.rows[0] || null,
  };
}

// Create a pending booking + tickets. This is the moment the 5-minute hold starts.
router.post("/", requireAuth, async (req, res, next) => {
  const { trip_id, coach_id, seats } = req.body || {};
  const tripId = parsePositiveId(trip_id);
  const coachId = parsePositiveId(coach_id);
  const from = normalizeStationCode(req.body?.from);
  const to = normalizeStationCode(req.body?.to);
  if (!tripId || !coachId || !Array.isArray(seats) || seats.length === 0 || seats.length > 5 || !from || !to || from === to) {
    return res.status(400).json({ error: "Choose between 1 and 5 seats, with a valid trip and journey." });
  }
  const passengers = [];
  for (const s of seats) {
    if (!isPlainObject(s)) return res.status(400).json({ error: "Every passenger entry must be an object." });
    const seatId = parsePositiveId(s.seat_id);
    const passengerName = normalizePassengerName(s.passenger_name);
    const passengerAge = parsePassengerAge(s.passenger_age);
    if (!seatId || !passengerName || !passengerAge) {
      return res.status(400).json({ error: "Please provide a valid name and age for every passenger." });
    }
    passengers.push({ seatId, passengerName, passengerAge });
  }
  if (new Set(passengers.map((passenger) => passenger.seatId)).size !== passengers.length) {
    return res.status(400).json({ error: "Each selected seat must be unique." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock each (trip, seat) pair so two simultaneous requests for the same
    // seat can never both pass the availability check — the second request
    // blocks here until the first transaction commits or rolls back.
    for (const passenger of passengers) {
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [tripId, passenger.seatId]);
    }

    const coachRes = await client.query(
      `SELECT c.*, tr.train_category FROM coach c JOIN trip t ON t.train_id = c.train_id
       JOIN train tr ON tr.train_id=c.train_id
       WHERE c.coach_id = $1 AND t.trip_id = $2`,
      [coachId, tripId]
    );
    if (!coachRes.rowCount) throw httpError(404, "Coach not found.");
    const coach = coachRes.rows[0];
    const seatIds = passengers.map((passenger) => passenger.seatId);
    const seatsRes = await client.query("SELECT seat_id FROM seat WHERE coach_id = $1 AND seat_id = ANY($2::int[])", [coachId, seatIds]);
    if (seatsRes.rowCount !== seatIds.length) throw httpError(400, "Every selected seat must belong to the selected coach.");
    const journeyRes = await client.query(
      `SELECT (rs_to.distance_km-rs_from.distance_km) AS distance_km FROM trip t
       JOIN route_station rs_from ON rs_from.route_id = t.route_id AND rs_from.station_code = $2
       JOIN route_station rs_to ON rs_to.route_id = t.route_id AND rs_to.station_code = $3
       WHERE t.trip_id = $1 AND rs_from.stop_order < rs_to.stop_order`,
      [tripId, from, to]
    );
    if (!journeyRes.rowCount) throw httpError(400, "This trip does not serve the selected journey.");
    const fareEach = calculateFare(journeyRes.rows[0].distance_km, coach.coach_type, coach.train_category);
    if (!fareEach) throw httpError(400, "Fare information is unavailable for this journey.");
    const takenRes = await client.query(
      `SELECT tk.seat_id FROM ticket tk
       JOIN booking b ON b.pnr_number = tk.pnr_number
       WHERE tk.trip_id = $1 AND tk.seat_id = ANY($2::int[])
      AND tk.ticket_status = 'active'
      AND (b.booking_status = 'confirmed'
              OR (b.booking_status = 'pending' AND now() - b.booking_date < interval '${HOLD_MINUTES} minutes'))`,
      [tripId, seatIds]
    );
    if (takenRes.rowCount) throw httpError(409, "This seat is no longer available. Please select another seat.");

    const pnr = genPnr();
    const fare = fareEach * passengers.length;

    await client.query(
      `INSERT INTO booking (pnr_number, user_id, starts_at_station, ends_at_station, booking_date, booking_status, fare)
       VALUES ($1,$2,$3,$4, now(), 'pending', $5)`,
      [pnr, req.user.user_id, from, to, fare]
    );
    for (const passenger of passengers) {
      await client.query(
        `INSERT INTO ticket (pnr_number, trip_id, seat_id, passenger_name, passenger_age, price)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [pnr, tripId, passenger.seatId, passenger.passengerName, passenger.passengerAge, fareEach]
      );
    }

    await client.query("COMMIT");
    res.status(201).json(await loadBookingFull(pnr));
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.*,
              CASE WHEN b.booking_status = 'pending' AND now() - b.booking_date >= interval '${HOLD_MINUTES} minutes'
                   THEN 'expired' ELSE b.booking_status END AS effective_status
              ,journey.train_name, journey.departure_date,
               journey.starts_at, journey.ends_at, journey.route_id
       FROM booking b
       LEFT JOIN LATERAL (
         SELECT tr.train_name, t.departure_date, t.route_id,
                to_char(t.departure_date::date + sf.departure_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,
                to_char(t.departure_date::date + st.arrival_time
                  + CASE WHEN st.arrival_time < sf.departure_time THEN interval '1 day' ELSE interval '0 day' END,
                  'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at
         FROM ticket tk
         JOIN trip t ON t.trip_id = tk.trip_id
         JOIN train tr ON tr.train_id = t.train_id
         JOIN train_station_schedule sf ON sf.train_id = t.train_id AND sf.route_id = t.route_id AND sf.station_code = b.starts_at_station
         JOIN train_station_schedule st ON st.train_id = t.train_id AND st.route_id = t.route_id AND st.station_code = b.ends_at_station
         WHERE tk.pnr_number = b.pnr_number
         ORDER BY tk.ticket_id LIMIT 1
       ) journey ON true
       WHERE b.user_id = $1
       ORDER BY b.booking_date DESC`,
      [req.user.user_id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Public ticket verification requires both the PNR and the booking owner email.
router.get("/verify", async (req, res, next) => {
  try {
    const pnr = normalizePnr(req.query.pnr);
    const email = typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : "";
    if (!pnr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid PNR and the email used for the booking." });
    }
    const { rows } = await pool.query(
      `SELECT b.pnr_number, b.booking_status, b.starts_at_station, b.ends_at_station, b.fare,
              u.email, t.departure_date, tr.train_name,
              to_char(t.departure_date::date + sf.departure_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,
              to_char(t.departure_date::date + st.arrival_time
                + CASE WHEN st.arrival_time < sf.departure_time THEN interval '1 day' ELSE interval '0 day' END,
                'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at
       FROM booking b JOIN users u ON u.user_id = b.user_id
       JOIN ticket tk ON tk.pnr_number = b.pnr_number AND tk.ticket_status = 'active'
       JOIN trip t ON t.trip_id = tk.trip_id JOIN train tr ON tr.train_id = t.train_id
       JOIN train_station_schedule sf ON sf.train_id = t.train_id AND sf.route_id = t.route_id AND sf.station_code = b.starts_at_station
       JOIN train_station_schedule st ON st.train_id = t.train_id AND st.route_id = t.route_id AND st.station_code = b.ends_at_station
       WHERE b.pnr_number = $1 AND lower(u.email) = $2
       ORDER BY tk.ticket_id LIMIT 1`, [pnr, email]
    );
    if (!rows.length) return res.status(404).json({ error: "No active ticket matches that PNR and email." });
    const ticketRows = await pool.query(
      `SELECT passenger_name, passenger_age, seat_number, coach_number, coach_type
       FROM ticket tk JOIN seat s ON s.seat_id = tk.seat_id JOIN coach c ON c.coach_id = s.coach_id
       WHERE tk.pnr_number = $1 AND tk.ticket_status = 'active' ORDER BY tk.ticket_id`, [pnr]
    );
    const { email: _privateEmail, ...booking } = rows[0];
    res.json({ ...booking, tickets: ticketRows.rows });
  } catch (err) { next(err); }
});

router.get("/:pnr", requireAuth, async (req, res, next) => {
  try {
    const pnr = normalizePnr(req.params.pnr);
    if (!pnr) return res.status(400).json({ error: "Invalid booking reference." });
    const full = await loadBookingFull(pnr);
    if (!full) return res.status(404).json({ error: "Booking not found." });
    if (full.booking.user_id !== req.user.user_id) return res.status(403).json({ error: "This booking does not belong to you." });
    res.json(full);
  } catch (err) {
    next(err);
  }
});

// Verifies expiry and prior payment server-side — never trusts the client.
router.post("/:pnr/pay", requireAuth, async (req, res, next) => {
  const pnr = normalizePnr(req.params.pnr);
  const { method } = req.body || {};
  if (!pnr || !["bKash", "Nagad", "Card"].includes(method)) return res.status(400).json({ error: "A valid booking reference and payment method are required." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const bRes = await client.query("SELECT * FROM booking WHERE pnr_number = $1 FOR UPDATE", [pnr]);
    if (!bRes.rowCount) throw httpError(404, "Booking not found.");
    const booking = bRes.rows[0];
    if (booking.user_id !== req.user.user_id) throw httpError(403, "This booking does not belong to you.");

    const expired =
      booking.booking_status === "pending" &&
      Date.now() - new Date(booking.booking_date).getTime() >= HOLD_MINUTES * 60 * 1000;

    if (expired) {
      await client.query("UPDATE booking SET booking_status = 'expired' WHERE pnr_number = $1", [pnr]);
      throw httpError(410, "Your temporary seat reservation has expired.");
    }
    if (booking.booking_status !== "pending") {
      throw httpError(409, `This booking is already ${booking.booking_status}.`);
    }

    const existingPay = await client.query("SELECT 1 FROM payment WHERE pnr_number = $1", [pnr]);
    if (existingPay.rowCount) throw httpError(409, "This booking has already been paid.");

    await client.query("INSERT INTO payment (pnr_number, amount, payment_method) VALUES ($1,$2,$3)", [
      pnr,
      booking.fare,
      method,
    ]);
    await client.query("UPDATE booking SET booking_status = 'confirmed' WHERE pnr_number = $1", [pnr]);

    await client.query("COMMIT");
    res.json(await loadBookingFull(pnr));
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

// A customer can explicitly abandon only their own unpaid hold. This releases
// the seats immediately because availability ignores cancelled bookings.
router.delete("/:pnr", requireAuth, async (req, res, next) => {
  const pnr = normalizePnr(req.params.pnr);
  if (!pnr) return res.status(400).json({ error: "Invalid booking reference." });

  try {
    const { rows } = await pool.query(
      `UPDATE booking
       SET booking_status = 'cancelled'
       WHERE pnr_number = $1
         AND user_id = $2
         AND booking_status = 'pending'
         AND now() - booking_date < interval '${HOLD_MINUTES} minutes'
       RETURNING pnr_number, booking_status`,
      [pnr, req.user.user_id]
    );
    if (!rows.length) return res.status(409).json({ error: "Only your active pending booking can be cancelled." });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Cancels one passenger ticket; paid tickets receive an immediate recorded
// full-price simulated refund (the prototype does not connect to a gateway).
router.delete("/:pnr/tickets/:ticketId", requireAuth, async (req, res, next) => {
  const pnr = normalizePnr(req.params.pnr);
  const ticketId = parsePositiveId(req.params.ticketId);
  if (!pnr || !ticketId) return res.status(400).json({ error: "Invalid booking or ticket reference." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const bRes = await client.query("SELECT * FROM booking WHERE pnr_number = $1 FOR UPDATE", [pnr]);
    if (!bRes.rowCount) throw httpError(404, "Booking not found.");
    const booking = bRes.rows[0];
    if (booking.user_id !== req.user.user_id) throw httpError(403, "This booking does not belong to you.");
    const ticketRes = await client.query(
      `SELECT tk.* FROM ticket tk WHERE tk.ticket_id = $1 AND tk.pnr_number = $2 FOR UPDATE`, [ticketId, pnr]
    );
    if (!ticketRes.rowCount || ticketRes.rows[0].ticket_status !== "active") throw httpError(404, "Active ticket not found.");
    if (!["pending", "confirmed"].includes(booking.booking_status)) throw httpError(409, "This booking can no longer be changed.");
    if (booking.booking_status === "pending" && Date.now() - new Date(booking.booking_date).getTime() >= HOLD_MINUTES * 60000) {
      throw httpError(410, "The payment hold has expired.");
    }
    const ticket = ticketRes.rows[0];
    const payRes = await client.query("SELECT * FROM payment WHERE pnr_number = $1", [pnr]);
    let refund = null;
    if (payRes.rowCount) {
      const refundRes = await client.query(
        `INSERT INTO ticket_refund (ticket_id, payment_id, amount) VALUES ($1, $2, $3)
         RETURNING amount, refund_status, processed_at`, [ticketId, payRes.rows[0].payment_id, ticket.price]
      );
      refund = refundRes.rows[0];
    } else {
      await client.query("UPDATE booking SET fare = GREATEST(0, fare - $2) WHERE pnr_number = $1", [pnr, ticket.price]);
    }
    await client.query("UPDATE ticket SET ticket_status = 'cancelled' WHERE ticket_id = $1", [ticketId]);
    const remaining = await client.query("SELECT COUNT(*)::int AS count FROM ticket WHERE pnr_number = $1 AND ticket_status = 'active'", [pnr]);
    if (remaining.rows[0].count === 0) await client.query("UPDATE booking SET booking_status = 'cancelled' WHERE pnr_number = $1", [pnr]);
    await client.query("COMMIT");
    res.json({ ticket_id: ticketId, ticket_status: "cancelled", refund });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally { client.release(); }
});

module.exports = router;
