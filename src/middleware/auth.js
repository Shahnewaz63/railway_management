const jwt = require("jsonwebtoken");
const pool = require("../db/pool");

function readCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";
  const match = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = readCookie(req, "bd_railway_session") || (header.startsWith("Bearer ") ? header.slice(7) : null);
  if (!token) return res.status(401).json({ error: "Please log in to continue." });
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    if (!user.jti) return res.status(401).json({ error: "Your session is invalid. Please log in again." });
    const { rows } = await pool.query(
      `SELECT 1 FROM auth_session
       WHERE session_id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()`,
      [user.jti, user.user_id]
    );
    if (!rows.length) return res.status(401).json({ error: "Your session is no longer active. Please log in again." });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Your session has expired. Please log in again." });
  }
}

async function requireAdmin(req, res, next) {
  try {
    // Check the current database role rather than trusting an old JWT claim.
    // This means removing an admin role takes effect immediately.
    const { rows } = await pool.query("SELECT role FROM users WHERE user_id = $1", [req.user.user_id]);
    if (!rows.length || rows[0].role !== "admin") {
      return res.status(403).json({ error: "Admin access is required." });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth, requireAdmin };
