const router = require("express").Router();
const pool = require("../db/pool");

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.route_id, r.route_name,
              json_agg(json_build_object(
                'station_code', s.station_code,
                'station_name', s.station_name,
                'city', s.city,
                'stop_order', rs.stop_order
              ) ORDER BY rs.stop_order) AS stations
       FROM route r JOIN route_station rs ON rs.route_id = r.route_id
       JOIN station s ON s.station_code = rs.station_code
       GROUP BY r.route_id
       ORDER BY r.route_name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
