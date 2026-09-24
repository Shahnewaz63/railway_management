const router = require("express").Router();
const pool = require("../db/pool");
const { HOLD_MINUTES } = require("../config/fares");
const { parsePositiveId, parseOptionalEnum } = require("../lib/request-validation");
const { FARES } = require("../config/fares");

router.get("/:tripId/coaches", async (req, res, next) => {
  try {
    const tripId = parsePositiveId(req.params.tripId);
    const classFilter = parseOptionalEnum(req.query.klass, Object.keys(FARES));
    if (!tripId || !classFilter.valid) return res.status(400).json({ error: "Invalid trip or class." });

    const tripRes = await pool.query(
      `SELECT t.*, tr.train_name FROM trip t JOIN train tr ON tr.train_id = t.train_id WHERE t.trip_id = $1`,
      [tripId]
    );
    if (!tripRes.rowCount) return res.status(404).json({ error: "Trip not found." });
    const trip = tripRes.rows[0];

    const coachRes = await pool.query(
      `SELECT * FROM coach WHERE train_id = $1 AND ($2::text IS NULL OR coach_type = $2) ORDER BY coach_number`,
      [trip.train_id, classFilter.value]
    );
    res.json({ trip, coaches: coachRes.rows });
  } catch (err) {
    next(err);
  }
});

router.get("/:tripId/coaches/:coachId/seats", async (req, res, next) => {
  try {
    const tripId = parsePositiveId(req.params.tripId);
    const coachId = parsePositiveId(req.params.coachId);
    if (!tripId || !coachId) return res.status(400).json({ error: "Invalid trip or coach." });
    const coachRes = await pool.query(
      `SELECT c.* FROM coach c
       JOIN trip t ON t.train_id = c.train_id
       WHERE c.coach_id = $1 AND t.trip_id = $2`,
      [coachId, tripId]
    );
    if (!coachRes.rowCount) return res.status(404).json({ error: "Coach not found." });

    const { rows } = await pool.query(
      `SELECT s.seat_id, s.seat_number, s.seat_type,
              EXISTS (
                SELECT 1 FROM ticket tk
                JOIN booking b ON b.pnr_number = tk.pnr_number
                WHERE tk.seat_id = s.seat_id AND tk.trip_id = $1 AND tk.ticket_status = 'active'
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
