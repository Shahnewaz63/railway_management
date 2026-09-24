const jwt = require("jsonwebtoken");
const pool = require("../db/pool");

function readCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";
  const match = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

// The single-page app calls every /api/* route with fetch(), the same way
// regardless of who is signed in — that's what an API is for, and blocking it
// outright would break the app for every customer. What CAN be blocked is
// someone typing an API URL straight into the address bar, following a
// bookmarked link, etc.: browsers mark that kind of top-level navigation with
// `Sec-Fetch-Mode: navigate` / `Sec-Fetch-Dest: document`, headers that
// fetch() calls made by our own frontend never send. We use that signal to
// make /api/* invisible to direct browsing for everyone except a signed-in
// administrator (who may want to inspect it directly).
//
// IMPORTANT CAVEAT, stated plainly so it's never mistaken for a security
// boundary: this only affects how the API *looks* when visited directly in a
// browser. Anyone can spoof these headers with curl/Postman, so it changes
// nothing about who can actually read or write data. That boundary is, and
// remains, enforced separately by requireAuth/requireAdmin and the
// ownership checks inside each route handler — this middleware runs in
// addition to those, never instead of them.
async function hideApiFromDirectBrowsing(req, res, next) {
  const looksLikeTopLevelNavigation =
    req.headers["sec-fetch-mode"] === "navigate" || req.headers["sec-fetch-dest"] === "document";
  if (!looksLikeTopLevelNavigation) return next();

  try {
    const token = readCookie(req, "bd_railway_session");
    if (!token) return res.status(404).end();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.jti) return res.status(404).end();
    const { rows } = await pool.query(
      `SELECT u.role FROM auth_session s
       JOIN users u ON u.user_id = s.user_id
       WHERE s.session_id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [decoded.jti, decoded.user_id]
    );
    if (!rows.length || rows[0].role !== "admin") return res.status(404).end();
    return next();
  } catch {
    return res.status(404).end();
  }
}

module.exports = { hideApiFromDirectBrowsing };
