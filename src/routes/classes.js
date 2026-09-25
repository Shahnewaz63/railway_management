const router = require("express").Router();
const pool = require("../db/pool");
const { FARES, FARE_PER_KM, CLASS_INFO } = require("../config/fares");

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT DISTINCT coach_type FROM coach ORDER BY coach_type");
    const classes = rows.map((r) => ({
      coach_type: r.coach_type,
      fare: FARES[r.coach_type] ?? null,
      fare_per_km: FARE_PER_KM[r.coach_type] ?? null,
      ...(CLASS_INFO[r.coach_type] || { seatType: "—", comfort: "—", ac: "—", use: "Standard rail travel." }),
    }));
    res.json(classes);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
