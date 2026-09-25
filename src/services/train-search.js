const pool = require("../db/pool");
const { FARES, calculateFare, HOLD_MINUTES } = require("../config/fares");
const { normalizeStationCode, parseIsoDate, parseOptionalEnum } = require("../lib/request-validation");

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function searchTrains({ from: rawFrom, to: rawTo, date: rawDate, klass: rawClass }) {
  const from = normalizeStationCode(rawFrom);
  const to = normalizeStationCode(rawTo);
  const date = parseIsoDate(rawDate);
  const classFilter = parseOptionalEnum(rawClass ?? undefined, Object.keys(FARES));
  if (!from || !to || !date || !classFilter.valid) throw httpError(400, "Valid from, to, date and class values are required.");
  if (from === to) throw httpError(400, "Departure and destination stations must be different.");

  const stationsRes = await pool.query("SELECT station_code FROM station WHERE station_code IN ($1,$2)", [from, to]);
  if (stationsRes.rowCount < 2) throw httpError(400, "Invalid departure or destination station.");
  const windowRes = await pool.query("SELECT CURRENT_DATE::text AS today, (CURRENT_DATE + 365)::text AS last_date");
  const { today, last_date: lastDate } = windowRes.rows[0];
  if (date < today || date > lastDate) throw httpError(400, `Choose a travel date from ${today} through ${lastDate}.`);

  await pool.query(
    `INSERT INTO trip (train_id, route_id, departure_date, status)
     SELECT schedule.train_id, schedule.route_id, $1::date, 'scheduled'
     FROM (
       SELECT train_id, route_id, COUNT(*) AS scheduled_stops
       FROM train_station_schedule GROUP BY train_id, route_id
     ) schedule
     JOIN (
       SELECT route_id, COUNT(*) AS route_stops FROM route_station GROUP BY route_id
     ) route ON route.route_id = schedule.route_id
     WHERE schedule.scheduled_stops = route.route_stops
     ON CONFLICT (train_id, departure_date) DO NOTHING`,
    [date]
  );

  const tripsRes = await pool.query(
    `SELECT t.trip_id, t.train_id, t.route_id, t.departure_date, t.status, tr.train_name, tr.train_category,
            sf.departure_time AS origin_departure_time, st.arrival_time AS destination_arrival_time,
            to_char(t.departure_date::date + sf.departure_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS origin_departure,
            to_char(t.departure_date::date + st.arrival_time
              + CASE WHEN st.arrival_time < sf.departure_time THEN interval '1 day' ELSE interval '0 day' END,
              'YYYY-MM-DD"T"HH24:MI:SS') AS destination_arrival,
            sf.station_code AS origin_station_code, st.station_code AS destination_station_code,
            (to_stop.distance_km-from_stop.distance_km) AS journey_distance_km, route_info.stops
     FROM trip t
     JOIN train tr ON tr.train_id = t.train_id
     JOIN train_station_schedule sf ON sf.train_id = t.train_id AND sf.route_id = t.route_id AND sf.station_code = $1
     JOIN train_station_schedule st ON st.train_id = t.train_id AND st.route_id = t.route_id AND st.station_code = $2
     JOIN route_station from_stop ON from_stop.route_id=t.route_id AND from_stop.station_code=$1
     JOIN route_station to_stop ON to_stop.route_id=t.route_id AND to_stop.station_code=$2
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
     WHERE t.status = 'scheduled' AND t.departure_date::date = $3::date
       AND EXISTS (
         SELECT 1 FROM route_station rs_from
         JOIN route_station rs_to ON rs_to.route_id = rs_from.route_id
         WHERE rs_from.route_id = t.route_id AND rs_from.station_code = $1
           AND rs_to.station_code = $2 AND rs_from.stop_order < rs_to.stop_order
       )
     ORDER BY t.departure_date::date + sf.departure_time`,
    [from, to, date]
  );

  const trips = [];
  for (const trip of tripsRes.rows) {
    const classRes = await pool.query(
      `SELECT c.coach_type, COUNT(s.seat_id) AS total,
              COUNT(s.seat_id) FILTER (WHERE EXISTS (
                SELECT 1 FROM ticket tk JOIN booking b ON b.pnr_number = tk.pnr_number
                WHERE tk.seat_id = s.seat_id AND tk.trip_id = $1 AND tk.ticket_status = 'active'
                  AND (b.booking_status = 'confirmed'
                    OR (b.booking_status = 'pending' AND now() - b.booking_date < interval '${HOLD_MINUTES} minutes'))
              )) AS taken
       FROM coach c JOIN seat s ON s.coach_id = c.coach_id
       WHERE c.train_id = $2 GROUP BY c.coach_type ORDER BY c.coach_type`,
      [trip.trip_id, trip.train_id]
    );
    let classes = classRes.rows.map((row) => ({
      coach_type: row.coach_type,
      total: Number(row.total),
      available: Number(row.total) - Number(row.taken),
      fare: calculateFare(trip.journey_distance_km, row.coach_type, trip.train_category),
    }));
    if (classFilter.value) classes = classes.filter((item) => item.coach_type === classFilter.value);
    trips.push({ ...trip, classes });
  }
  return trips;
}

module.exports = { searchTrains };
