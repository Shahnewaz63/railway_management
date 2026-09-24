const router = require("express").Router();
const pool = require("../db/pool");
const { requireAuth, requireCustomer } = require("../middleware/auth");

router.use(requireAuth, requireCustomer);

function text(value, max) {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (!clean || clean.length > max || /[\u0000-\u001F\u007F]/u.test(clean)) return null;
  return clean;
}

router.post("/", async (req, res, next) => {
  const name = text(req.body?.name, 100);
  const email = text(req.body?.email, 254)?.toLowerCase();
  const subject = text(req.body?.subject, 150);
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !subject || !message || message.length > 5000 || /[\u0000\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(message)) {
    return res.status(400).json({ error: "Enter a valid name, email, subject, and message (up to 5,000 characters)." });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO contact_message (user_id, name, email, subject, message)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING contact_id, submitted_at`,
      [req.user.user_id, name, email, subject, message]
    );
    res.status(201).json({ message: "Your message has been sent.", contact_id: rows[0].contact_id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
