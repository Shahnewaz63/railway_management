const router = require("express").Router();
const pool = require("../db/pool");
const { HOLD_MINUTES } = require("../config/fares");

router.get("/:tripId/coaches", async (req, res, next) => {
  try {
    const { tripId } = req.params;
    const { klass } = req.query;

    const tripRes = await pool.query(
      `SELECT t.*, tr.train_name FROM trip t JOIN train tr ON tr.train_id = t.train_id WHERE t.trip_id = $1`,
      [tripId]
    );
    if (!tripRes.rowCount) return res.status(404).json({ error: "Trip not found." });
    const trip = tripRes.rows[0];

    const coachRes = await pool.query(
      `SELECT * FROM coach WHERE train_id = $1 AND ($2::text IS NULL OR coach_type = $2) ORDER BY coach_number`,
      [trip.train_id, klass || null]
    );
    res.json({ trip, coaches: coachRes.rows });
  } catch (err) {
    next(err);
  }
});

router.get("/:tripId/coaches/:coachId/seats", async (req, res, next) => {
  try {
    const { tripId, coachId } = req.params;
    const coachRes = await pool.query("SELECT * FROM coach WHERE coach_id = $1", [coachId]);
    if (!coachRes.rowCount) return res.status(404).json({ error: "Coach not found." });

    const { rows } = await pool.query(
      `SELECT s.seat_id, s.seat_number, s.seat_type,
              EXISTS (
                SELECT 1 FROM ticket tk
                JOIN booking b ON b.pnr_number = tk.pnr_number
                WHERE tk.seat_id = s.seat_id AND tk.trip_id = $1
                  AND (b.booking_status = 'confirmed'
                       OR (b.booking_status = 'pending' AND now() - b.booking_date < interval '${HOLD_MINUTES} minutes'))
              ) AS taken
       FROM seat s
       WHERE s.coach_id = $2
       ORDER BY s.seat_number`,
      [tripId, coachId]
    );
    res.json({ coach: coachRes.rows[0], seats: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
