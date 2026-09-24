CREATE TABLE train_station_schedule (
  train_id       INT NOT NULL REFERENCES train(train_id) ON DELETE CASCADE,
  route_id       INT NOT NULL REFERENCES route(route_id) ON DELETE CASCADE,
  station_code   VARCHAR(10) NOT NULL,
  arrival_time   TIME NOT NULL,
  departure_time TIME NOT NULL,
  PRIMARY KEY (train_id, station_code),
  FOREIGN KEY (route_id, station_code) REFERENCES route_station(route_id, station_code) ON DELETE CASCADE
);

-- Give existing services a usable schedule immediately; deployments can then
-- adjust these train-specific times without rebuilding booking data.
INSERT INTO train_station_schedule (train_id, route_id, station_code, arrival_time, departure_time)
SELECT t.train_id, t.route_id, rs.station_code,
       (TIME '07:00' + (rs.stop_order - 1) * INTERVAL '2 hours' -
         CASE WHEN rs.stop_order = 1 THEN INTERVAL '0 minutes' ELSE INTERVAL '10 minutes' END)::time,
       (TIME '07:00' + (rs.stop_order - 1) * INTERVAL '2 hours' +
         CASE WHEN rs.stop_order = max_order THEN INTERVAL '0 minutes' ELSE INTERVAL '10 minutes' END)::time
FROM trip t
JOIN (SELECT route_id, station_code, stop_order,
             max(stop_order) OVER (PARTITION BY route_id) AS max_order
      FROM route_station) rs ON rs.route_id = t.route_id
GROUP BY t.train_id, t.route_id, rs.station_code, rs.stop_order, rs.max_order
ON CONFLICT (train_id, station_code) DO NOTHING;
