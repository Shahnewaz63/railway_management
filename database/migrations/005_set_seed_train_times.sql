UPDATE train_station_schedule sch
SET arrival_time = (
      CASE tr.train_name
        WHEN 'Subarna Express' THEN TIME '07:00'
        WHEN 'Mohanagar Godhuli' THEN TIME '15:00'
        WHEN 'Parabat Express' THEN TIME '06:20'
        WHEN 'Silk City Express' THEN TIME '14:30'
        WHEN 'Sundarban Express' THEN TIME '08:15'
        ELSE TIME '07:00'
      END
      + (rs.stop_order - 1) * INTERVAL '2 hours'
      - CASE WHEN rs.stop_order = 1 THEN INTERVAL '0 minutes' ELSE INTERVAL '10 minutes' END
    )::time,
    departure_time = (
      CASE tr.train_name
        WHEN 'Subarna Express' THEN TIME '07:00'
        WHEN 'Mohanagar Godhuli' THEN TIME '15:00'
        WHEN 'Parabat Express' THEN TIME '06:20'
        WHEN 'Silk City Express' THEN TIME '14:30'
        WHEN 'Sundarban Express' THEN TIME '08:15'
        ELSE TIME '07:00'
      END
      + (rs.stop_order - 1) * INTERVAL '2 hours'
      + CASE WHEN rs.stop_order = route_end.max_order THEN INTERVAL '0 minutes' ELSE INTERVAL '10 minutes' END
    )::time
FROM train tr, route_station rs,
     (SELECT route_id, max(stop_order) AS max_order FROM route_station GROUP BY route_id) route_end
WHERE tr.train_id = sch.train_id
  AND rs.route_id = sch.route_id
  AND rs.station_code = sch.station_code
  AND route_end.route_id = sch.route_id
  AND EXISTS (SELECT 1 FROM trip t WHERE t.train_id = tr.train_id AND t.route_id = sch.route_id);
