const router = require("express").Router();
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { isGmailConfigured, sendPasswordResetCode } = require("../lib/email");

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

function cleanResetCode(value) {
  return typeof value === "string" && /^\d{6}$/.test(value) ? value : null;
}

function resetCodeHash(email, code) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET).update(`${email}:${code}`).digest("hex");
}

router.post("/password-reset/request", async (req, res, next) => {
  const email = cleanEmail(req.body?.email);
  if (!email) return res.status(400).json({ error: "Enter a valid email address." });
  if (!isGmailConfigured()) return res.status(503).json({ error: "Password reset email is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD on the server." });

  const client = await pool.connect();
  let recipient = null;
  let code = null;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [email]);
    const userRes = await client.query("SELECT user_id, email, first_name FROM users WHERE email = $1", [email]);
    if (userRes.rowCount) {
      const user = userRes.rows[0];
      const recent = await client.query(
        `SELECT reset_id FROM password_reset_otp
         WHERE user_id = $1 AND created_at > now() - interval '60 seconds'
         ORDER BY created_at DESC LIMIT 1`, [user.user_id]
      );
      if (!recent.rowCount) {
        code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
        await client.query("UPDATE password_reset_otp SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL", [user.user_id]);
        await client.query(
          `INSERT INTO password_reset_otp (user_id, otp_hash, expires_at)
           VALUES ($1, $2, now() + interval '10 minutes')`, [user.user_id, resetCodeHash(email, code)]
        );
        recipient = user;
      }
    }
    await client.query("COMMIT");
    if (recipient && code) {
      try { await sendPasswordResetCode(recipient.email, recipient.first_name, code); }
      catch (mailError) {
        await pool.query("UPDATE password_reset_otp SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL", [recipient.user_id]);
        return res.status(503).json({ error: "The verification email could not be sent. Check Gmail SMTP settings and try again." });
      }
    }
    res.json({ message: "If this email belongs to an account, a verification code has been sent." });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally { client.release(); }
});

router.post("/password-reset/confirm", async (req, res, next) => {
  const email = cleanEmail(req.body?.email);
  const code = cleanResetCode(req.body?.otp);
  const password = req.body?.password;
  if (!email || !code || typeof password !== "string" || password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    return res.status(400).json({ error: "Enter a valid email, six digit code, and password between 8 and 72 characters." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const otpRes = await client.query(
      `SELECT pr.reset_id, pr.user_id, pr.otp_hash, pr.expires_at, pr.attempts, u.email
       FROM password_reset_otp pr JOIN users u ON u.user_id = pr.user_id
       WHERE u.email = $1 AND pr.consumed_at IS NULL
       ORDER BY pr.created_at DESC LIMIT 1 FOR UPDATE OF pr`, [email]
    );
    if (!otpRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "The code is invalid or has expired. Request a new code." });
    }
    const otp = otpRes.rows[0];
    if (otp.expires_at <= new Date() || otp.attempts >= 5) {
      await client.query("UPDATE password_reset_otp SET consumed_at = now() WHERE reset_id = $1", [otp.reset_id]);
      await client.query("COMMIT");
      return res.status(400).json({ error: "The code is invalid or has expired. Request a new code." });
    }
    await client.query("UPDATE password_reset_otp SET attempts = attempts + 1 WHERE reset_id = $1", [otp.reset_id]);
    const suppliedHash = Buffer.from(resetCodeHash(email, code), "hex");
    const storedHash = Buffer.from(otp.otp_hash, "hex");
    if (suppliedHash.length !== storedHash.length || !crypto.timingSafeEqual(suppliedHash, storedHash)) {
      if (otp.attempts + 1 >= 5) await client.query("UPDATE password_reset_otp SET consumed_at = now() WHERE reset_id = $1", [otp.reset_id]);
      await client.query("COMMIT");
      return res.status(400).json({ error: "The code is invalid or has expired. Request a new code." });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await client.query("UPDATE user_auth SET password_hash = $1 WHERE user_id = $2", [passwordHash, otp.user_id]);
    await client.query("UPDATE password_reset_otp SET consumed_at = now() WHERE reset_id = $1", [otp.reset_id]);
    await client.query("UPDATE auth_session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [otp.user_id]);
    await client.query("COMMIT");
    res.json({ message: "Password changed. Sign in with your new password." });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally { client.release(); }
});

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
