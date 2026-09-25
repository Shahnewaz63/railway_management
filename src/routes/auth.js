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
      date_of_birth: user.date_of_birth,
      role: user.role,
      jti: sessionId,
    },
    process.env.JWT_SECRET,
    { expiresIn: `${SESSION_DAYS}d` }
  );
}

function publicUser(u) {
  return { user_id: u.user_id, first_name: u.first_name, last_name: u.last_name, email: u.email, date_of_birth: u.date_of_birth || null, role: u.role };
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

function cleanBirthDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const cutoffYear = Number(parts.year) - 18;
  const month = Number(parts.month);
  const day = Math.min(Number(parts.day), new Date(Date.UTC(cutoffYear, month, 0)).getUTCDate());
  const latestEligibleBirthDate = `${cutoffYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return value <= latestEligibleBirthDate && value >= "1900-01-01" ? value : null;
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
    const currentCredential = await client.query("SELECT password_hash FROM user_auth WHERE user_id = $1 FOR UPDATE", [otp.user_id]);
    if (currentCredential.rowCount && await bcrypt.compare(password, currentCredential.rows[0].password_hash)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Choose a new password that is different from your current password." });
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
  const { first_name, last_name, email, date_of_birth, password } = req.body || {};
  const firstName = cleanName(first_name, "First name");
  const lastName = cleanName(last_name, "Last name");
  const normalizedEmail = cleanEmail(email);
  const birthDate = cleanBirthDate(date_of_birth);
  if (!firstName || !lastName || !normalizedEmail || !birthDate || typeof password !== "string") {
    return res.status(400).json({ error: "Enter your first name, last name, email, password, and a valid date of birth showing you are at least 18." });
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
      "INSERT INTO users (first_name, last_name, email, date_of_birth) VALUES ($1,$2,$3,$4) RETURNING *",
      [firstName, lastName, normalizedEmail, birthDate]
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
      `SELECT user_id, first_name, last_name, email, date_of_birth, role
       FROM users WHERE user_id = $1`,
      [req.user.user_id]
    );
    if (!rows.length) return res.status(401).json({ error: "Your account is no longer available." });
    res.json({ user: rows[0] });
  } catch (err) { next(err); }
});

router.put("/profile", requireAuth, async (req, res, next) => {
  const firstName = cleanName(req.body?.first_name, "First name");
  const lastName = cleanName(req.body?.last_name, "Last name");
  const birthDate = cleanBirthDate(req.body?.date_of_birth);
  const currentPassword = req.body?.current_password;
  if (!firstName || !lastName || !birthDate || typeof currentPassword !== "string" || !currentPassword) {
    return res.status(400).json({ error: "Enter your first name, last name, current password, and a valid date of birth showing you are at least 18." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const authResult = await client.query("SELECT password_hash FROM user_auth WHERE user_id = $1 FOR UPDATE", [req.user.user_id]);
    if (!authResult.rows.length || !(await bcrypt.compare(currentPassword, authResult.rows[0].password_hash))) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "Your current password is incorrect." });
    }
    const { rows } = await client.query(
      `UPDATE users SET first_name = $1, last_name = $2, date_of_birth = $3
       WHERE user_id = $4 RETURNING user_id, first_name, last_name, email, date_of_birth, role`,
      [firstName, lastName, birthDate, req.user.user_id]
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Your account is no longer available." });
    }
    await client.query("COMMIT");
    // Refresh the session claims so existing authenticated routes see the edited profile.
    setSessionCookie(res, signToken(rows[0], req.user.jti));
    res.json({ user: rows[0] });
  } catch (err) { await client.query("ROLLBACK"); next(err); }
  finally { client.release(); }
});

router.post("/password/change", requireAuth, async (req, res, next) => {
  const currentPassword = req.body?.current_password;
  const newPassword = req.body?.new_password;
  if (typeof currentPassword !== "string" || !currentPassword
    || typeof newPassword !== "string" || newPassword.length < 8
    || Buffer.byteLength(newPassword, "utf8") > 72) {
    return res.status(400).json({ error: "Enter your current password and a new password between 8 and 72 characters." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT a.password_hash, u.user_id, u.first_name, u.last_name, u.email, u.role
       FROM user_auth a JOIN users u ON u.user_id = a.user_id
       WHERE u.user_id = $1 FOR UPDATE OF a`, [req.user.user_id]
    );
    if (!rows.length || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Your current password is incorrect." });
    }
    if (await bcrypt.compare(newPassword, rows[0].password_hash)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Choose a new password that is different from your current password." });
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await client.query("UPDATE user_auth SET password_hash = $1 WHERE user_id = $2", [passwordHash, req.user.user_id]);
    await client.query(
      "UPDATE auth_session SET revoked_at = now() WHERE user_id = $1 AND session_id <> $2 AND revoked_at IS NULL",
      [req.user.user_id, req.user.jti]
    );
    await client.query("COMMIT");
    res.json({ message: "Password changed successfully." });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally { client.release(); }
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
