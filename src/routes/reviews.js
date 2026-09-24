const router = require("express").Router();
const pool = require("../db/pool");
const { requireAuth, requireCustomer } = require("../middleware/auth");
const { parsePositiveId } = require("../lib/request-validation");

router.get("/", async (req, res, next) => {
  const trainId = parsePositiveId(req.query.train_id);
  const routeId = parsePositiveId(req.query.route_id);
  if (!trainId || !routeId) return res.status(400).json({ error: "A train and route are required." });
  try {
    const { rows } = await pool.query(
      `SELECT rv.review_id, rv.rating, rv.comment, rv.created_at,
              u.first_name, u.last_name
       FROM train_review rv JOIN users u ON u.user_id = rv.user_id
       WHERE rv.train_id = $1 AND rv.route_id = $2
       ORDER BY rv.created_at DESC, rv.review_id DESC`, [trainId, routeId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post("/", requireAuth, requireCustomer, async (req, res, next) => {
  const trainId = parsePositiveId(req.body?.train_id);
  const routeId = parsePositiveId(req.body?.route_id);
  const rating = Number(req.body?.rating);
  const comment = typeof req.body?.comment === "string" ? req.body.comment.trim() : "";
  if (!trainId || !routeId || !Number.isInteger(rating) || rating < 1 || rating > 5 || !comment || comment.length > 1000) {
    return res.status(400).json({ error: "Choose a 1–5 star rating and enter a review of up to 1,000 characters." });
  }
  try {
    const eligible = await pool.query(
      `SELECT 1 FROM ticket tk JOIN booking b ON b.pnr_number = tk.pnr_number
       JOIN trip t ON t.trip_id = tk.trip_id
       WHERE b.user_id = $1 AND b.booking_status = 'confirmed'
         AND tk.ticket_status = 'active' AND t.train_id = $2 AND t.route_id = $3
       LIMIT 1`, [req.user.user_id, trainId, routeId]
    );
    if (!eligible.rowCount) return res.status(403).json({ error: "Reviews are available after a confirmed booking on this train and route." });
    const { rows } = await pool.query(
      `INSERT INTO train_review (user_id, train_id, route_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, train_id, route_id)
       DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, created_at = now()
       RETURNING review_id, rating, comment, created_at`,
      [req.user.user_id, trainId, routeId, rating, comment]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
