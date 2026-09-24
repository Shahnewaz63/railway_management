const router = require("express").Router();
const bcrypt = require("bcrypt");
const pool = require("../db/pool");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { HOLD_MINUTES } = require("../config/fares");
const {
  normalizePnr,
  parsePositiveId,
  normalizeStationCode,
  normalizePassengerName,
  parsePassengerAge,
} = require("../lib/request-validation");

router.use(requireAuth, requireAdmin);

// A small, protected dashboard endpoint. Add management routes here as the
// project grows; every route in this router is admin-only.
router.get("/summary", async (req, res, next) => {
  try {
    const [usersRes, tripsRes, bookingsRes] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE role = 'admin')::int AS admins,
                COUNT(*) FILTER (WHERE role = 'customer')::int AS customers
         FROM users`
      ),
      pool.query("SELECT COUNT(*)::int AS scheduled FROM trip WHERE status = 'scheduled'"),
      pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE booking_status = 'confirmed')::int AS confirmed,
                COUNT(*) FILTER (WHERE booking_status = 'pending' AND now() - booking_date < interval '${HOLD_MINUTES} minutes')::int AS pending
         FROM booking`
      ),
    ]);

    res.json({
      users: usersRes.rows[0],
      trips: tripsRes.rows[0],
      bookings: bookingsRes.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// Administrators can review every account and grant/revoke administrator
// access. Public registration never calls this route, so it cannot self-assign
// elevated privileges.
router.get("/users", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT user_id, first_name, last_name, email, role
       FROM users
       ORDER BY role DESC, first_name, last_name, user_id`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/booking-options", async (req, res, next) => {
  try {
    await pool.query(
      `INSERT INTO trip (train_id, route_id, departure_date, status)
       SELECT service.train_id, service.route_id, CURRENT_DATE + days.day_offset, 'scheduled'
       FROM (
         SELECT sch.train_id, sch.route_id, COUNT(*) AS scheduled_stops
         FROM train_station_schedule sch GROUP BY sch.train_id, sch.route_id
       ) service
       JOIN (SELECT route_id, COUNT(*) AS route_stops FROM route_station GROUP BY route_id) route
         ON route.route_id = service.route_id AND route.route_stops = service.scheduled_stops
       CROSS JOIN generate_series(0, 365) AS days(day_offset)
       ON CONFLICT (train_id, departure_date) DO NOTHING`
    );
    const [customers, stations, trips, coaches] = await Promise.all([
      pool.query("SELECT user_id, first_name, last_name, email FROM users WHERE role = 'customer' ORDER BY first_name, last_name"),
      pool.query("SELECT station_code, station_name, city FROM station ORDER BY city, station_name"),
      pool.query(`SELECT t.trip_id, t.train_id, t.route_id, t.departure_date, tr.train_name
                  FROM trip t JOIN train tr ON tr.train_id = t.train_id
                  WHERE t.status = 'scheduled' AND t.departure_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 365
                  ORDER BY t.departure_date, tr.train_name`),
      pool.query("SELECT coach_id, train_id, coach_number, coach_type FROM coach ORDER BY train_id, coach_number"),
    ]);
    res.json({ customers: customers.rows, stations: stations.rows, trips: trips.rows, coaches: coaches.rows });
  } catch (err) { next(err); }
});

router.get("/booking-options/seats", async (req, res, next) => {
  const tripId = parsePositiveId(req.query.trip_id);
  const coachId = parsePositiveId(req.query.coach_id);
  if (!tripId || !coachId) return res.status(400).json({ error: "Choose a trip and coach." });
  try {
    const { rows } = await pool.query(
      `SELECT s.seat_id, s.seat_number
       FROM seat s JOIN coach c ON c.coach_id = s.coach_id
       JOIN trip t ON t.train_id = c.train_id
       WHERE t.trip_id = $1 AND c.coach_id = $2 AND t.status = 'scheduled'
         AND NOT EXISTS (
           SELECT 1 FROM ticket tk JOIN booking b ON b.pnr_number = tk.pnr_number
           WHERE tk.trip_id = t.trip_id AND tk.seat_id = s.seat_id AND tk.ticket_status = 'active'
             AND (b.booking_status = 'confirmed' OR (b.booking_status = 'pending' AND now() - b.booking_date < interval '${HOLD_MINUTES} minutes'))
         )
       ORDER BY s.seat_number`, [tripId, coachId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

function newAdminPnr() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return `PNR${Array.from({ length: 7 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")}`;
}

router.post("/bookings/custom", async (req, res, next) => {
  const userId = parsePositiveId(req.body?.user_id);
  const tripId = parsePositiveId(req.body?.trip_id);
  const coachId = parsePositiveId(req.body?.coach_id);
  const seatId = parsePositiveId(req.body?.seat_id);
  const from = normalizeStationCode(req.body?.from);
  const to = normalizeStationCode(req.body?.to);
  const passengerName = normalizePassengerName(req.body?.passenger_name);
  const passengerAge = parsePassengerAge(req.body?.passenger_age);
  const fare = Number(req.body?.fare);
  const status = req.body?.status;
  const method = req.body?.payment_method;
  if (!userId || !tripId || !coachId || !seatId || !from || !to || from === to || !passengerName || !passengerAge || !Number.isFinite(fare) || fare < 0 || fare > 1000000 || !["pending", "confirmed"].includes(status) || (status === "confirmed" && !["bKash", "Nagad", "Card"].includes(method))) {
    return res.status(400).json({ error: "Complete all customer, journey, seat, passenger, fare and payment fields with valid values." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query("SELECT 1 FROM users WHERE user_id = $1 AND role = 'customer'", [userId]);
    if (!user.rowCount) throw Object.assign(new Error("Choose a valid customer account."), { status: 400 });
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [tripId, seatId]);
    const trip = await client.query("SELECT * FROM trip WHERE trip_id = $1 AND status = 'scheduled' FOR UPDATE", [tripId]);
    if (!trip.rowCount) throw Object.assign(new Error("Choose a scheduled train."), { status: 400 });
    const seat = await client.query("SELECT s.seat_id, c.train_id FROM seat s JOIN coach c ON c.coach_id = s.coach_id WHERE s.seat_id = $1 AND s.coach_id = $2", [seatId, coachId]);
    if (!seat.rowCount || seat.rows[0].train_id !== trip.rows[0].train_id) throw Object.assign(new Error("The seat and coach must belong to the selected train."), { status: 400 });
    const journey = await client.query(
      `SELECT 1 FROM route_station a JOIN route_station b ON b.route_id = a.route_id
       WHERE a.route_id = $1 AND a.station_code = $2 AND b.station_code = $3 AND a.stop_order < b.stop_order`,
      [trip.rows[0].route_id, from, to]
    );
    if (!journey.rowCount) throw Object.assign(new Error("The selected train does not serve this journey in that direction."), { status: 400 });
    const taken = await client.query(
      `SELECT 1 FROM ticket tk JOIN booking b ON b.pnr_number = tk.pnr_number
       WHERE tk.trip_id = $1 AND tk.seat_id = $2 AND tk.ticket_status = 'active'
         AND (b.booking_status = 'confirmed' OR (b.booking_status = 'pending' AND now() - b.booking_date < interval '${HOLD_MINUTES} minutes'))`,
      [tripId, seatId]
    );
    if (taken.rowCount) throw Object.assign(new Error("That seat is already booked or held."), { status: 409 });
    let pnr = newAdminPnr();
    for (let tries = 0; tries < 3; tries++) {
      const exists = await client.query("SELECT 1 FROM booking WHERE pnr_number = $1", [pnr]);
      if (!exists.rowCount) break;
      pnr = newAdminPnr();
    }
    await client.query(
      `INSERT INTO booking (pnr_number, user_id, starts_at_station, ends_at_station, booking_status, fare)
       VALUES ($1,$2,$3,$4,$5,$6)`, [pnr, userId, from, to, status, fare]
    );
    const coach = await client.query("SELECT coach_type FROM coach WHERE coach_id = $1", [coachId]);
    await client.query(
      `INSERT INTO ticket (pnr_number, trip_id, seat_id, passenger_name, passenger_age, price)
       VALUES ($1,$2,$3,$4,$5,$6)`, [pnr, tripId, seatId, passengerName, passengerAge, fare]
    );
    if (status === "confirmed") await client.query("INSERT INTO payment (pnr_number, amount, payment_method) VALUES ($1,$2,$3)", [pnr, fare, method]);
    await client.query("COMMIT");
    res.status(201).json({ pnr_number: pnr, booking_status: status, coach_type: coach.rows[0].coach_type });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally { client.release(); }
});

function cleanText(value, label, { min = 1, max = 100 } = {}) {
  if (typeof value !== "string") throw Object.assign(new Error(`${label} is required.`), { status: 400 });
  const cleaned = value.trim();
  if (cleaned.length < min || cleaned.length > max) {
    throw Object.assign(new Error(`${label} must be between ${min} and ${max} characters.`), { status: 400 });
  }
  return cleaned;
}

function cleanEmail(value) {
  const email = cleanText(value, "Email", { max: 100 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error("Please provide a valid email address."), { status: 400 });
  }
  return email;
}

// This is the administrative provisioning path for both roles. It is guarded
// by requireAdmin; public registration remains customer-only.
router.post("/users", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { first_name, last_name, email, password, role } = req.body || {};
    const firstName = cleanText(first_name, "First name", { max: 50 });
    const lastName = cleanText(last_name, "Last name", { max: 50 });
    const normalizedEmail = cleanEmail(email);
    if (typeof password !== "string" || password.length < 8 || password.length > 200) {
      throw Object.assign(new Error("Password must be between 8 and 200 characters."), { status: 400 });
    }
    if (!["customer", "admin"].includes(role)) {
      throw Object.assign(new Error("Role must be customer or admin."), { status: 400 });
    }

    await client.query("BEGIN");
    const existing = await client.query("SELECT 1 FROM users WHERE email = $1", [normalizedEmail]);
    if (existing.rowCount) {
      throw Object.assign(new Error("An account with this email already exists."), { status: 409 });
    }
    const { rows } = await client.query(
      `INSERT INTO users (first_name, last_name, email, role)
       VALUES ($1, $2, $3, $4)
       RETURNING user_id, first_name, last_name, email, role`,
      [firstName, lastName, normalizedEmail, role]
    );
    const hash = await bcrypt.hash(password, 12);
    await client.query("INSERT INTO user_auth (user_id, password_hash) VALUES ($1, $2)", [rows[0].user_id, hash]);
    await client.query("COMMIT");
    res.status(201).json({ user: rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

router.patch("/users/:userId/role", async (req, res, next) => {
  const userId = parsePositiveId(req.params.userId);
  const { role } = req.body || {};
  if (!Number.isInteger(userId) || !["customer", "admin"].includes(role)) {
    return res.status(400).json({ error: "A valid user and role are required." });
  }
  if (userId === req.user.user_id) {
    return res.status(400).json({ error: "You cannot change your own administrator role." });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE users SET role = $1 WHERE user_id = $2
       RETURNING user_id, first_name, last_name, email, role`,
      [role, userId]
    );
    if (!rows.length) return res.status(404).json({ error: "User not found." });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.get("/bookings", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.pnr_number, b.booking_status, b.booking_date, b.fare,
              b.starts_at_station, b.ends_at_station,
              u.first_name, u.last_name, u.email,
              COUNT(tk.ticket_id)::int AS passenger_count,
              MIN(t.departure_date) AS departure_date,
              STRING_AGG(DISTINCT tr.train_name, ', ') AS train_names
       FROM booking b
       JOIN users u ON u.user_id = b.user_id
       LEFT JOIN ticket tk ON tk.pnr_number = b.pnr_number
       LEFT JOIN trip t ON t.trip_id = tk.trip_id
       LEFT JOIN train tr ON tr.train_id = t.train_id
       GROUP BY b.pnr_number, u.user_id
       ORDER BY b.booking_date DESC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Cancellation releases all seats because availability counts only confirmed
// and active pending bookings. Payments remain recorded for audit purposes.
router.patch("/bookings/:pnr/cancel", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const pnr = normalizePnr(req.params.pnr);
    if (!pnr) {
      return res.status(400).json({ error: "Invalid booking reference." });
    }
    await client.query("BEGIN");
    const b = await client.query("SELECT * FROM booking WHERE pnr_number = $1 FOR UPDATE", [pnr]);
    if (!b.rowCount || !["pending", "confirmed"].includes(b.rows[0].booking_status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Only pending or confirmed bookings can be cancelled." });
    }
    const payment = await client.query("SELECT payment_id FROM payment WHERE pnr_number = $1", [pnr]);
    if (payment.rowCount) {
      await client.query(
        `INSERT INTO ticket_refund (ticket_id, payment_id, amount)
         SELECT ticket_id, $2, price FROM ticket
         WHERE pnr_number = $1 AND ticket_status = 'active'
         ON CONFLICT (ticket_id) DO NOTHING`, [pnr, payment.rows[0].payment_id]
      );
    }
    await client.query("UPDATE ticket SET ticket_status = 'cancelled' WHERE pnr_number = $1 AND ticket_status = 'active'", [pnr]);
    const { rows } = await client.query(
      "UPDATE booking SET booking_status = 'cancelled' WHERE pnr_number = $1 RETURNING pnr_number, booking_status", [pnr]
    );
    await client.query("COMMIT");
    res.json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally { client.release(); }
});

// Ticket-level view across every booking (past and present), for support and
// data-entry corrections — the admin dashboard's "All Tickets" panel.
router.get("/records", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.pnr_number, b.booking_status, b.starts_at_station, b.ends_at_station,
              b.booking_date, b.fare, u.user_id, u.first_name, u.last_name, u.email,
              tk.ticket_id, tk.passenger_name, tk.passenger_age, tk.price, tk.ticket_status,
              s.seat_id, s.seat_number, c.coach_id, c.coach_number, c.coach_type,
              t.trip_id, t.departure_date, tr.train_name
       FROM booking b
       JOIN users u ON u.user_id = b.user_id
       LEFT JOIN ticket tk ON tk.pnr_number = b.pnr_number
       LEFT JOIN seat s ON s.seat_id = tk.seat_id
       LEFT JOIN coach c ON c.coach_id = s.coach_id
       LEFT JOIN trip t ON t.trip_id = tk.trip_id
       LEFT JOIN train tr ON tr.train_id = t.train_id
       ORDER BY b.booking_date DESC, b.pnr_number, tk.ticket_id`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/contacts", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT contact_id, user_id, name, email, subject, message, submitted_at
       FROM contact_message ORDER BY submitted_at DESC, contact_id DESC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.delete("/contacts/:contactId", async (req, res, next) => {
  const contactId = parsePositiveId(req.params.contactId);
  if (!contactId) return res.status(400).json({ error: "Invalid contact message." });
  try {
    const { rowCount } = await pool.query("DELETE FROM contact_message WHERE contact_id = $1", [contactId]);
    if (!rowCount) return res.status(404).json({ error: "Contact message not found." });
    res.status(204).end();
  } catch (err) { next(err); }
});

// Corrects passenger details on an existing ticket — e.g. a misspelled name
// or a wrong age entered at booking time. Deliberately narrow: it does not
// touch seat assignment, fare, or booking status, which each have their own
// dedicated, availability-aware flows elsewhere.
router.patch("/tickets/:ticketId", async (req, res, next) => {
  const ticketId = parsePositiveId(req.params.ticketId);
  if (!ticketId) return res.status(400).json({ error: "Invalid ticket." });

  const updates = {};
  if (req.body?.passenger_name !== undefined) {
    const name = normalizePassengerName(req.body.passenger_name);
    if (!name) return res.status(400).json({ error: "Please provide a valid passenger name." });
    updates.passenger_name = name;
  }
  if (req.body?.passenger_age !== undefined) {
    const age = parsePassengerAge(req.body.passenger_age);
    if (!age) return res.status(400).json({ error: "Please provide a valid passenger age." });
    updates.passenger_age = age;
  }
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: "Nothing to update." });
  }

  try {
    const setClauses = Object.keys(updates).map((key, i) => `${key} = $${i + 2}`).join(", ");
    const { rows } = await pool.query(
      `UPDATE ticket SET ${setClauses} WHERE ticket_id = $1
       RETURNING ticket_id, pnr_number, passenger_name, passenger_age`,
      [ticketId, ...Object.values(updates)]
    );
    if (!rows.length) return res.status(404).json({ error: "Ticket not found." });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
