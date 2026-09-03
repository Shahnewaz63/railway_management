const router = require("express").Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

function signToken(user) {
  return jwt.sign(
    { user_id: user.user_id, first_name: user.first_name, last_name: user.last_name, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function publicUser(u) {
  return { user_id: u.user_id, first_name: u.first_name, last_name: u.last_name, email: u.email };
}

router.post("/register", async (req, res, next) => {
  const { first_name, last_name, email, password } = req.body || {};
  if (!first_name || !last_name || !email || !password) {
    return res.status(400).json({ error: "First name, last name, email and password are all required." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT 1 FROM users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "An account with this email already exists." });
    }
    const userRes = await client.query(
      "INSERT INTO users (first_name, last_name, email) VALUES ($1,$2,$3) RETURNING *",
      [first_name.trim(), last_name.trim(), email.trim().toLowerCase()]
    );
    const user = userRes.rows[0];
    const hash = await bcrypt.hash(password, 10);
    await client.query("INSERT INTO user_auth (user_id, password_hash) VALUES ($1,$2)", [user.user_id, hash]);
    await client.query("COMMIT");
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
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
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

    const result = await pool.query(
      `SELECT u.*, a.password_hash FROM users u
       JOIN user_auth a ON a.user_id = u.user_id
       WHERE u.email = $1`,
      [email.trim().toLowerCase()]
    );
    if (!result.rowCount) return res.status(401).json({ error: "Incorrect email or password." });

    const row = result.rows[0];
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: "Incorrect email or password." });

    res.json({ token: signToken(row), user: publicUser(row) });
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
