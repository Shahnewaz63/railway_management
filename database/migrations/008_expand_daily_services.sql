-- Extend the demo network with bookable intermediate stations and services.
-- Safe to apply to an existing database; records are keyed by stable names/codes.

INSERT INTO station (station_code, station_name, city) VALUES
  ('COM', 'Cumilla Railway Station', 'Cumilla'),
  ('FNI', 'Feni Railway Station', 'Feni'),
  ('COX', 'Cox''s Bazar Railway Station', 'Cox''s Bazar'),
  ('LKS', 'Laksham Junction', 'Laksham'),
  ('NOK', 'Noakhali Railway Station', 'Noakhali'),
  ('MYM', 'Mymensingh Railway Station', 'Mymensingh'),
  ('JML', 'Jamalpur Town Railway Station', 'Jamalpur'),
  ('TNG', 'Tangail Railway Station', 'Tangail'),
  ('ISD', 'Ishwardi Junction', 'Ishwardi'),
  ('JSR', 'Jashore Junction', 'Jashore'),
  ('SRE', 'Sreemangal Railway Station', 'Sreemangal')
ON CONFLICT (station_code) DO NOTHING;

-- Place new stops in the existing corridors, retaining each station's route order.
UPDATE route_station rs SET stop_order = v.stop_order
FROM route r, (VALUES
  ('Dhaka - Chittagong Main Line', 'BSL', 2),
  ('Dhaka - Chittagong Main Line', 'AKR', 3),
  ('Dhaka - Chittagong Main Line', 'LKS', 4),
  ('Dhaka - Chittagong Main Line', 'COM', 5),
  ('Dhaka - Chittagong Main Line', 'FNI', 6),
  ('Dhaka - Chittagong Main Line', 'CTG', 7),
  ('Dhaka - Chittagong Main Line', 'COX', 8),
  ('Dhaka - Sylhet Line', 'BSL', 2),
  ('Dhaka - Sylhet Line', 'SRE', 3),
  ('Dhaka - Sylhet Line', 'SYL', 4),
  ('Dhaka - Rajshahi Line', 'TNG', 2),
  ('Dhaka - Rajshahi Line', 'ISD', 3),
  ('Dhaka - Rajshahi Line', 'RAJ', 4),
  ('Dhaka - Khulna Line', 'JSR', 2),
  ('Dhaka - Khulna Line', 'KHL', 3)
) AS v(route_name, station_code, stop_order)
WHERE r.route_name = v.route_name AND rs.route_id = r.route_id AND rs.station_code = v.station_code;

INSERT INTO route_station (route_id, station_code, stop_order)
SELECT r.route_id, v.station_code, v.stop_order
FROM route r
JOIN (VALUES
  ('Dhaka - Chittagong Main Line', 'BSL', 2),
  ('Dhaka - Chittagong Main Line', 'LKS', 4),
  ('Dhaka - Chittagong Main Line', 'COM', 5),
  ('Dhaka - Chittagong Main Line', 'FNI', 6),
  ('Dhaka - Chittagong Main Line', 'COX', 8),
  ('Dhaka - Sylhet Line', 'SRE', 3),
  ('Dhaka - Rajshahi Line', 'TNG', 2),
  ('Dhaka - Rajshahi Line', 'ISD', 3),
  ('Dhaka - Khulna Line', 'JSR', 2)
) AS v(route_name, station_code, stop_order) ON r.route_name = v.route_name
ON CONFLICT (route_id, station_code) DO UPDATE SET stop_order = EXCLUDED.stop_order;

INSERT INTO route (route_name)
SELECT name FROM (VALUES ('Dhaka - Noakhali Connector'), ('Dhaka - Mymensingh Line')) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM route r WHERE r.route_name = v.name);

INSERT INTO route_station (route_id, station_code, stop_order)
SELECT r.route_id, v.station_code, v.stop_order
FROM route r
JOIN (VALUES
  ('Dhaka - Noakhali Connector', 'DHK', 1),
  ('Dhaka - Noakhali Connector', 'BSL', 2),
  ('Dhaka - Noakhali Connector', 'AKR', 3),
  ('Dhaka - Noakhali Connector', 'LKS', 4),
  ('Dhaka - Noakhali Connector', 'NOK', 5),
  ('Dhaka - Mymensingh Line', 'DHK', 1),
  ('Dhaka - Mymensingh Line', 'MYM', 2),
  ('Dhaka - Mymensingh Line', 'JML', 3)
) AS v(route_name, station_code, stop_order) ON r.route_name = v.route_name
ON CONFLICT (route_id, station_code) DO UPDATE SET stop_order = EXCLUDED.stop_order;

INSERT INTO train (train_name)
SELECT name FROM (VALUES
  ('Titas Express'), ('Meghna Express'), ('Brahmaputra Express'), ('Madhumati Express')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM train t WHERE t.train_name = v.name);

-- Each added service is assigned to its route through a schedule row.
WITH new_services(train_name, route_name, start_time) AS (VALUES
  ('Titas Express', 'Dhaka - Chittagong Main Line', TIME '10:00'),
  ('Meghna Express', 'Dhaka - Noakhali Connector', TIME '08:00'),
  ('Brahmaputra Express', 'Dhaka - Mymensingh Line', TIME '16:00'),
  ('Madhumati Express', 'Dhaka - Khulna Line', TIME '21:00')
), service_routes AS (
  SELECT DISTINCT t.train_id, t.route_id
  FROM trip t
  UNION
  SELECT tr.train_id, r.route_id
  FROM new_services ns
  JOIN train tr ON tr.train_name = ns.train_name
  JOIN route r ON r.route_name = ns.route_name
)
INSERT INTO train_station_schedule (train_id, route_id, station_code, arrival_time, departure_time)
SELECT sr.train_id, sr.route_id, rs.station_code,
       (starts.start_time + (rs.stop_order - 1) * INTERVAL '90 minutes'
         - CASE WHEN rs.stop_order = 1 THEN INTERVAL '0 minutes' ELSE INTERVAL '8 minutes' END)::time,
       (starts.start_time + (rs.stop_order - 1) * INTERVAL '90 minutes'
         + CASE WHEN rs.stop_order = ends.max_order THEN INTERVAL '0 minutes' ELSE INTERVAL '8 minutes' END)::time
FROM service_routes sr
JOIN train tr ON tr.train_id = sr.train_id
JOIN route_station rs ON rs.route_id = sr.route_id
JOIN (SELECT route_id, MAX(stop_order) AS max_order FROM route_station GROUP BY route_id) ends ON ends.route_id = sr.route_id
JOIN LATERAL (
  SELECT CASE tr.train_name
    WHEN 'Subarna Express' THEN TIME '07:00'
    WHEN 'Mohanagar Godhuli' THEN TIME '15:00'
    WHEN 'Parabat Express' THEN TIME '06:20'
    WHEN 'Silk City Express' THEN TIME '14:30'
    WHEN 'Sundarban Express' THEN TIME '08:15'
    WHEN 'Titas Express' THEN TIME '10:00'
    WHEN 'Meghna Express' THEN TIME '08:00'
    WHEN 'Brahmaputra Express' THEN TIME '16:00'
    WHEN 'Madhumati Express' THEN TIME '21:00'
    ELSE TIME '07:00'
  END AS start_time
) starts ON true
ON CONFLICT (train_id, station_code) DO UPDATE
SET route_id = EXCLUDED.route_id,
    arrival_time = EXCLUDED.arrival_time,
    departure_time = EXCLUDED.departure_time;

INSERT INTO coach (train_id, coach_number, coach_type, capacity)
SELECT tr.train_id, v.coach_number, v.coach_type, v.capacity
FROM train tr
JOIN (VALUES
  ('Titas Express', 1, 'Shuvon Chair', 48), ('Titas Express', 2, 'Snigdha', 32),
  ('Meghna Express', 1, 'Shuvon Chair', 48), ('Meghna Express', 2, 'Snigdha', 32),
  ('Brahmaputra Express', 1, 'Shuvon Chair', 48), ('Brahmaputra Express', 2, 'Snigdha', 32),
  ('Madhumati Express', 1, 'Shuvon Chair', 48), ('Madhumati Express', 2, 'Snigdha', 32)
) AS v(train_name, coach_number, coach_type, capacity) ON v.train_name = tr.train_name
WHERE NOT EXISTS (SELECT 1 FROM coach c WHERE c.train_id = tr.train_id AND c.coach_number = v.coach_number);

INSERT INTO seat (coach_id, seat_number, seat_type)
SELECT c.coach_id, lpad(n::text, 2, '0'), CASE WHEN n % 4 IN (0, 3) THEN 'Window' ELSE 'Aisle' END
FROM coach c
JOIN train tr ON tr.train_id = c.train_id
CROSS JOIN LATERAL generate_series(1, c.capacity) AS numbers(n)
WHERE tr.train_name IN ('Titas Express', 'Meghna Express', 'Brahmaputra Express', 'Madhumati Express')
ON CONFLICT (coach_id, seat_number) DO NOTHING;

-- One daily trip per service. This index lets search safely materialize any
-- selected date without creating duplicates when customers search together.
CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_train_departure_unique ON trip (train_id, departure_date);

INSERT INTO trip (train_id, route_id, departure_date, status)
SELECT service.train_id, service.route_id, CURRENT_DATE + days.day_offset, 'scheduled'
FROM (SELECT DISTINCT train_id, route_id FROM train_station_schedule) service
CROSS JOIN generate_series(0, 30) AS days(day_offset)
ON CONFLICT (train_id, departure_date) DO NOTHING;
