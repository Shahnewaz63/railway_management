const router = require("express").Router();
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { FARES, HOLD_MINUTES } = require("../config/fares");

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
  const { trip_id, coach_id, seats, from, to } = req.body || {};
  if (!trip_id || !coach_id || !Array.isArray(seats) || seats.length === 0 || !from || !to) {
    return res.status(400).json({ error: "trip_id, coach_id, seats, from and to are required." });
  }
  for (const s of seats) {
    if (!s.seat_id || !s.passenger_name || !String(s.passenger_name).trim() || !s.passenger_age || Number(s.passenger_age) <= 0) {
      return res.status(400).json({ error: "Please provide a valid name and age for every passenger." });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock each (trip, seat) pair so two simultaneous requests for the same
    // seat can never both pass the availability check — the second request
    // blocks here until the first transaction commits or rolls back.
    for (const s of seats) {
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [Number(trip_id), Number(s.seat_id)]);
    }

    const coachRes = await client.query("SELECT * FROM coach WHERE coach_id = $1", [coach_id]);
    if (!coachRes.rowCount) throw httpError(404, "Coach not found.");
    const coach = coachRes.rows[0];
    const fareEach = FARES[coach.coach_type] ?? 0;

    const seatIds = seats.map((s) => Number(s.seat_id));
    const takenRes = await client.query(
      `SELECT tk.seat_id FROM ticket tk
       JOIN booking b ON b.pnr_number = tk.pnr_number
       WHERE tk.trip_id = $1 AND tk.seat_id = ANY($2::int[])
         AND (b.booking_status = 'confirmed'
              OR (b.booking_status = 'pending' AND now() - b.booking_date < interval '${HOLD_MINUTES} minutes'))`,
      [trip_id, seatIds]
    );
    if (takenRes.rowCount) throw httpError(409, "This seat is no longer available. Please select another seat.");

    const pnr = genPnr();
    const fare = fareEach * seats.length;

    await client.query(
      `INSERT INTO booking (pnr_number, user_id, starts_at_station, ends_at_station, booking_date, booking_status, fare)
       VALUES ($1,$2,$3,$4, now(), 'pending', $5)`,
      [pnr, req.user.user_id, from, to, fare]
    );
    for (const s of seats) {
      await client.query(
        `INSERT INTO ticket (pnr_number, trip_id, seat_id, passenger_name, passenger_age, price)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [pnr, trip_id, s.seat_id, String(s.passenger_name).trim(), Number(s.passenger_age), fareEach]
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
    const full = await loadBookingFull(req.params.pnr);
    if (!full) return res.status(404).json({ error: "Booking not found." });
    if (full.booking.user_id !== req.user.user_id) return res.status(403).json({ error: "This booking does not belong to you." });
    res.json(full);
  } catch (err) {
    next(err);
  }
});

// Verifies expiry and prior payment server-side — never trusts the client.
router.post("/:pnr/pay", requireAuth, async (req, res, next) => {
  const { pnr } = req.params;
  const { method } = req.body || {};
  if (!method) return res.status(400).json({ error: "Payment method is required." });

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

module.exports = router;
