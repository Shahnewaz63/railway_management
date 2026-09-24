const router = require("express").Router();
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const SESSION_DAYS = 7;

function signToken(user, sessionId) {
  return jwt.sign(
    {
      user_id: user.user_id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      role: user.role,
      jti: sessionId,
    },
    process.env.JWT_SECRET,
    { expiresIn: `${SESSION_DAYS}d` }
  );
}

function publicUser(u) {
  return { user_id: u.user_id, first_name: u.first_name, last_name: u.last_name, email: u.email, role: u.role };
}

function setSessionCookie(res, token) {
  res.cookie("bd_railway_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

async function createSession(client, user) {
  const sessionId = crypto.randomUUID();
  await client.query(
    "INSERT INTO auth_session (session_id, user_id, expires_at) VALUES ($1, $2, now() + interval '7 days')",
    [sessionId, user.user_id]
  );
  return signToken(user, sessionId);
}

function cleanEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 100 ? email : null;
}

function cleanName(value, label) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 50 && !/[\u0000-\u001F\u007F]/.test(name) ? name : null;
}

router.post("/register", async (req, res, next) => {
  const { first_name, last_name, email, password } = req.body || {};
  const firstName = cleanName(first_name, "First name");
  const lastName = cleanName(last_name, "Last name");
  const normalizedEmail = cleanEmail(email);
  if (!firstName || !lastName || !normalizedEmail || typeof password !== "string") {
    return res.status(400).json({ error: "First name, last name, email and password are all required." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT 1 FROM users WHERE email = $1", [normalizedEmail]);
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "An account with this email already exists." });
    }
    const userRes = await client.query(
      "INSERT INTO users (first_name, last_name, email) VALUES ($1,$2,$3) RETURNING *",
      [firstName, lastName, normalizedEmail]
    );
    const user = userRes.rows[0];
    const hash = await bcrypt.hash(password, 10);
    await client.query("INSERT INTO user_auth (user_id, password_hash) VALUES ($1,$2)", [user.user_id, hash]);
    const token = await createSession(client, user);
    await client.query("COMMIT");
    setSessionCookie(res, token);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const normalizedEmail = cleanEmail(email);
    if (!normalizedEmail || typeof password !== "string" || !password) return res.status(400).json({ error: "A valid email and password are required." });

    const result = await pool.query(
      `SELECT u.*, a.password_hash FROM users u
       JOIN user_auth a ON a.user_id = u.user_id
       WHERE u.email = $1`,
      [normalizedEmail]
    );
    if (!result.rowCount) return res.status(401).json({ error: "Incorrect email or password." });

    const row = result.rows[0];
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: "Incorrect email or password." });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const token = await createSession(client, row);
      await client.query("COMMIT");
      setSessionCookie(res, token);
      res.json({ user: publicUser(row) });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT user_id, first_name, last_name, email, role
       FROM users WHERE user_id = $1`,
      [req.user.user_id]
    );
    if (!rows.length) return res.status(401).json({ error: "Your account is no longer available." });
    res.json({ user: rows[0] });
  } catch (err) { next(err); }
});

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await pool.query("UPDATE auth_session SET revoked_at = now() WHERE session_id = $1", [req.user.jti]);
    res.clearCookie("bd_railway_session", { httpOnly: true, sameSite: "lax", path: "/" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
