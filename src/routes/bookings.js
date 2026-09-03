const router = require("express").Router();
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { FARES, HOLD_MINUTES } = require("../config/fares");
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
    `SELECT tk.*, s.seat_number, c.coach_number, c.coach_type, t.departure_date, tr.train_name
     FROM ticket tk
     JOIN seat s ON s.seat_id = tk.seat_id
     JOIN coach c ON c.coach_id = s.coach_id
     JOIN trip t ON t.trip_id = tk.trip_id
     JOIN train tr ON tr.train_id = t.train_id
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
  if (!tripId || !coachId || !Array.isArray(seats) || seats.length === 0 || seats.length > 10 || !from || !to || from === to) {
    return res.status(400).json({ error: "trip_id, coach_id, seats, from and to are required." });
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
      `SELECT c.* FROM coach c JOIN trip t ON t.train_id = c.train_id
       WHERE c.coach_id = $1 AND t.trip_id = $2`,
      [coachId, tripId]
    );
    if (!coachRes.rowCount) throw httpError(404, "Coach not found.");
    const coach = coachRes.rows[0];
    const fareEach = FARES[coach.coach_type] ?? 0;

    const seatIds = passengers.map((passenger) => passenger.seatId);
    const seatsRes = await client.query("SELECT seat_id FROM seat WHERE coach_id = $1 AND seat_id = ANY($2::int[])", [coachId, seatIds]);
    if (seatsRes.rowCount !== seatIds.length) throw httpError(400, "Every selected seat must belong to the selected coach.");
    const journeyRes = await client.query(
      `SELECT 1 FROM trip t
       JOIN route_station rs_from ON rs_from.route_id = t.route_id AND rs_from.station_code = $2
       JOIN route_station rs_to ON rs_to.route_id = t.route_id AND rs_to.station_code = $3
       WHERE t.trip_id = $1 AND rs_from.stop_order < rs_to.stop_order`,
      [tripId, from, to]
    );
    if (!journeyRes.rowCount) throw httpError(400, "This trip does not serve the selected journey.");
    const takenRes = await client.query(
      `SELECT tk.seat_id FROM ticket tk
       JOIN booking b ON b.pnr_number = tk.pnr_number
       WHERE tk.trip_id = $1 AND tk.seat_id = ANY($2::int[])
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
       FROM booking b
       WHERE b.user_id = $1
       ORDER BY b.booking_date DESC`,
      [req.user.user_id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
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

module.exports = router;
