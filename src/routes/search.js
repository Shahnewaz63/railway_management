const router = require("express").Router();
const pool = require("../db/pool");
const { FARES, HOLD_MINUTES } = require("../config/fares");
const { normalizeStationCode, parseIsoDate, parseOptionalEnum } = require("../lib/request-validation");

// GET /api/search?from=DHK&to=CTG&date=2026-09-15&klass=Snigdha
router.get("/", async (req, res, next) => {
  try {
    const from = normalizeStationCode(req.query.from);
    const to = normalizeStationCode(req.query.to);
    const date = parseIsoDate(req.query.date);
    const classFilter = parseOptionalEnum(req.query.klass, Object.keys(FARES));
    if (!from || !to || !date || !classFilter.valid) return res.status(400).json({ error: "Valid from, to, date and class values are required." });
    if (from === to) return res.status(400).json({ error: "Departure and destination stations must be different." });

    const stationsRes = await pool.query("SELECT station_code FROM station WHERE station_code IN ($1,$2)", [from, to]);
    if (stationsRes.rowCount < 2) return res.status(400).json({ error: "Invalid departure or destination station." });

    // A trip only serves this journey if its route contains both stations
    // with the origin's stop_order strictly before the destination's.
    const tripsRes = await pool.query(
      `SELECT t.trip_id, t.train_id, t.route_id, t.departure_date, t.status, tr.train_name,
              sf.departure_time AS origin_departure_time,
              st.arrival_time AS destination_arrival_time,
              to_char(t.departure_date::date + sf.departure_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS origin_departure,
              to_char(t.departure_date::date + st.arrival_time
                + CASE WHEN st.arrival_time < sf.departure_time THEN interval '1 day' ELSE interval '0 day' END,
                'YYYY-MM-DD"T"HH24:MI:SS') AS destination_arrival,
              sf.station_code AS origin_station_code, st.station_code AS destination_station_code, route_info.stops
       FROM trip t
       JOIN train tr ON tr.train_id = t.train_id
       JOIN train_station_schedule sf ON sf.train_id = t.train_id AND sf.route_id = t.route_id AND sf.station_code = $1
       JOIN train_station_schedule st ON st.train_id = t.train_id AND st.route_id = t.route_id AND st.station_code = $2
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
           'station_code', rs.station_code, 'station_name', s.station_name, 'city', s.city,
           'arrival_time', sch.arrival_time, 'departure_time', sch.departure_time
         ) ORDER BY rs.stop_order) AS stops
         FROM route_station rs
         JOIN station s ON s.station_code = rs.station_code
         JOIN train_station_schedule sch ON sch.train_id = t.train_id AND sch.route_id = t.route_id AND sch.station_code = rs.station_code
         WHERE rs.route_id = t.route_id
       ) route_info ON true
       WHERE t.status = 'scheduled'
         AND t.departure_date::date = $3::date
         AND EXISTS (
           SELECT 1 FROM route_station rs_from
           JOIN route_station rs_to ON rs_to.route_id = rs_from.route_id
           WHERE rs_from.route_id = t.route_id
             AND rs_from.station_code = $1
             AND rs_to.station_code = $2
             AND rs_from.stop_order < rs_to.stop_order
         )
       ORDER BY t.departure_date::date + sf.departure_time`,
      [from, to, date]
    );

    const trips = [];
    for (const trip of tripsRes.rows) {
      const classRes = await pool.query(
        `SELECT c.coach_type,
                COUNT(s.seat_id) AS total,
                COUNT(s.seat_id) FILTER (
                  WHERE EXISTS (
                    SELECT 1 FROM ticket tk
                    JOIN booking b ON b.pnr_number = tk.pnr_number
                    WHERE tk.seat_id = s.seat_id AND tk.trip_id = $1
                      AND (b.booking_status = 'confirmed'
                           OR (b.booking_status = 'pending' AND now() - b.booking_date < interval '${HOLD_MINUTES} minutes'))
                  )
                ) AS taken
         FROM coach c
         JOIN seat s ON s.coach_id = c.coach_id
         WHERE c.train_id = $2
         GROUP BY c.coach_type
         ORDER BY c.coach_type`,
        [trip.trip_id, trip.train_id]
      );

      let classes = classRes.rows.map((r) => ({
        coach_type: r.coach_type,
        total: Number(r.total),
        available: Number(r.total) - Number(r.taken),
        fare: FARES[r.coach_type] ?? 0,
      }));
      if (classFilter.value) classes = classes.filter((c) => c.coach_type === classFilter.value);

      trips.push({ ...trip, classes });
    }

    res.json(trips);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
