const router = require("express").Router();
const bcrypt = require("bcrypt");
const pool = require("../db/pool");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { HOLD_MINUTES } = require("../config/fares");
const {
  normalizePnr,
  parsePositiveId,
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
  try {
    const pnr = normalizePnr(req.params.pnr);
    if (!pnr) {
      return res.status(400).json({ error: "Invalid booking reference." });
    }
    const { rows } = await pool.query(
      `UPDATE booking
       SET booking_status = 'cancelled'
       WHERE pnr_number = $1
         AND booking_status IN ('pending', 'confirmed')
       RETURNING pnr_number, booking_status`,
      [pnr]
    );
    if (!rows.length) {
      return res.status(409).json({ error: "Only pending or confirmed bookings can be cancelled." });
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// Ticket-level view across every booking (past and present), for support and
// data-entry corrections — the admin dashboard's "All Tickets" panel.
router.get("/tickets", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT tk.ticket_id, tk.pnr_number, tk.passenger_name, tk.passenger_age, tk.price,
              s.seat_id, s.seat_number, c.coach_id, c.coach_number, c.coach_type,
              t.trip_id, t.departure_date, tr.train_name,
              b.booking_status, b.starts_at_station, b.ends_at_station, b.booking_date,
              u.user_id, u.first_name, u.last_name, u.email
       FROM ticket tk
       JOIN seat s ON s.seat_id = tk.seat_id
       JOIN coach c ON c.coach_id = s.coach_id
       JOIN trip t ON t.trip_id = tk.trip_id
       JOIN train tr ON tr.train_id = t.train_id
       JOIN booking b ON b.pnr_number = tk.pnr_number
       JOIN users u ON u.user_id = b.user_id
       ORDER BY b.booking_date DESC, tk.ticket_id`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
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
