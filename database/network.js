// Representative Bangladesh Railway services and route geography. Times in
// this demo timetable are generated to avoid same-route service overlap; they
// are not a substitute for the operator's live timetable.
const STATIONS = [
  ["DHK", "Dhaka Kamalapur Railway Station", "Dhaka"], ["CTG", "Chattogram Railway Station", "Chattogram"],
  ["SYL", "Sylhet Railway Station", "Sylhet"], ["RAJ", "Rajshahi Railway Station", "Rajshahi"],
  ["KHL", "Khulna Railway Station", "Khulna"], ["BSL", "Bhairab Bazar Railway Station", "Bhairab"],
  ["AKR", "Akhaura Railway Station", "Akhaura"], ["COM", "Cumilla Railway Station", "Cumilla"],
  ["FNI", "Feni Railway Station", "Feni"], ["COX", "Cox's Bazar Railway Station", "Cox's Bazar"],
  ["LKS", "Laksham Junction", "Laksham"], ["NOK", "Noakhali Railway Station", "Noakhali"],
  ["MYM", "Mymensingh Railway Station", "Mymensingh"], ["JML", "Jamalpur Town Railway Station", "Jamalpur"],
  ["TNG", "Tangail Railway Station", "Tangail"], ["ISD", "Ishwardi Junction", "Ishwardi"],
  ["JSR", "Jashore Junction", "Jashore"], ["SRE", "Sreemangal Railway Station", "Sreemangal"],
  ["KIS", "Kishoreganj Railway Station", "Kishoreganj"], ["NTR", "Natore Railway Station", "Natore"],
  ["STH", "Santahar Junction", "Santahar"], ["JYP", "Joypurhat Railway Station", "Joypurhat"],
  ["PBT", "Parbatipur Junction", "Parbatipur"], ["DIN", "Dinajpur Railway Station", "Dinajpur"],
  ["BNL", "Benapole Railway Station", "Benapole"], ["NTK", "Netrokona Railway Station", "Netrokona"],
  ["MHG", "Mohanganj Railway Station", "Mohanganj"], ["DGN", "Dewanganj Bazar Railway Station", "Dewanganj"],
  ["TRK", "Tarakandi Railway Station", "Tarakandi"], ["BHG", "Bhanga Junction", "Bhanga"],
];

const ROUTES = [
  { name: "Dhaka - Chattogram Main Line", stops: [["DHK",0],["BSL",78],["AKR",125],["COM",190],["FNI",260],["CTG",320]] },
  { name: "Dhaka - Cox's Bazar Line", stops: [["DHK",0],["COM",190],["FNI",260],["CTG",320],["COX",480]] },
  { name: "Dhaka - Sylhet Line", stops: [["DHK",0],["BSL",78],["SRE",245],["SYL",320]] },
  { name: "Dhaka - Rajshahi Line", stops: [["DHK",0],["TNG",100],["ISD",255],["RAJ",350]] },
  { name: "Dhaka - Khulna Line", stops: [["DHK",0],["JSR",300],["KHL",410]] },
  { name: "Dhaka - Dinajpur Line", stops: [["DHK",0],["TNG",100],["ISD",255],["NTR",325],["STH",385],["JYP",435],["PBT",510],["DIN",545]] },
  { name: "Dhaka - Noakhali Line", stops: [["DHK",0],["BSL",78],["AKR",125],["LKS",180],["NOK",235]] },
  { name: "Dhaka - Mymensingh Line", stops: [["DHK",0],["MYM",120],["JML",190]] },
  { name: "Dhaka - Kishoreganj Line", stops: [["DHK",0],["BSL",78],["KIS",155]] },
  { name: "Dhaka - Benapole Line", stops: [["DHK",0],["JSR",300],["BNL",375]] },
  { name: "Dhaka - Mohanganj Line", stops: [["DHK",0],["MYM",120],["NTK",175],["MHG",235]] },
  { name: "Dhaka - Dewanganj Line", stops: [["DHK",0],["MYM",120],["JML",190],["DGN",255]] },
  { name: "Dhaka - Tarakandi Line", stops: [["DHK",0],["MYM",120],["JML",190],["TRK",245]] },
  { name: "Dhaka - Bhanga Line", stops: [["DHK",0],["BHG",80]] },
  { name: "Chattogram - Sylhet Line", stops: [["CTG",0],["FNI",60],["AKR",130],["BSL",180],["SRE",345],["SYL",420]] },
];

// Times are spaced by more than each route's generated running time. Coach
// identifiers are the familiar Bengali letter series, with varied capacities.
const TRAINS = [
  ["Subarna Express","Dhaka - Chattogram Main Line","00:00"],
  ["Mohanagar Godhuli","Dhaka - Chattogram Main Line","08:00"],
  ["Sonar Bangla Express","Dhaka - Chattogram Main Line","16:00"],
  ["Cox's Bazar Express","Dhaka - Cox's Bazar Line","00:00"],
  ["Parjotak Express","Dhaka - Cox's Bazar Line","12:00"],
  ["Parabat Express","Dhaka - Sylhet Line","02:00"],
  ["Jayantika Express","Dhaka - Sylhet Line","10:00"],
  ["Upaban Express","Dhaka - Sylhet Line","18:00"],
  ["Silk City Express","Dhaka - Rajshahi Line","04:00"],
  ["Padma Express","Dhaka - Rajshahi Line","12:00"],
  ["Dhumketu Express","Dhaka - Rajshahi Line","20:00"],
  ["Sundarban Express","Dhaka - Khulna Line","05:00"],
  ["Chitra Express","Dhaka - Khulna Line","17:00"],
  ["Ekota Express","Dhaka - Dinajpur Line","00:00"],
  ["Drutojan Express","Dhaka - Dinajpur Line","12:00"],
  ["Upakul Express","Dhaka - Noakhali Line","00:00"],
  ["Meghna Express","Dhaka - Noakhali Line","08:00"],
  ["Brahmaputra Express","Dhaka - Dewanganj Line","00:00"],
  ["Tista Express","Dhaka - Dewanganj Line","08:00"],
  ["Jamuna Express","Dhaka - Tarakandi Line","12:00"],
  ["Egarosindhur Provati","Dhaka - Kishoreganj Line","00:00"],
  ["Kishoreganj Express","Dhaka - Kishoreganj Line","08:00"],
  ["Benapole Express","Dhaka - Benapole Line","00:00"],
  ["Madhumati Express","Dhaka - Bhanga Line","08:00"],
  ["Mohanganj Express","Dhaka - Mohanganj Line","00:00"],
  ["Haor Express","Dhaka - Mohanganj Line","12:00"],
  ["Paharika Express","Chattogram - Sylhet Line","00:00"],
  ["Udayan Express","Chattogram - Sylhet Line","12:00"],
];

const TRAIN_CATEGORY_BY_NAME = {
  "Subarna Express": "Premium", "Mohanagar Godhuli": "Express", "Sonar Bangla Express": "Business",
  "Cox's Bazar Express": "Premium", "Parjotak Express": "Express",
  "Parabat Express": "Express", "Jayantika Express": "Standard", "Upaban Express": "Overnight",
  "Silk City Express": "Express", "Padma Express": "Standard", "Dhumketu Express": "Overnight",
  "Sundarban Express": "Express", "Chitra Express": "Standard", "Ekota Express": "Express",
  "Drutojan Express": "Premium", "Upakul Express": "Standard", "Meghna Express": "Express",
  "Brahmaputra Express": "Overnight", "Tista Express": "Standard", "Jamuna Express": "Express",
  "Egarosindhur Provati": "Standard", "Kishoreganj Express": "Express", "Benapole Express": "Premium",
  "Madhumati Express": "Standard", "Mohanganj Express": "Express", "Haor Express": "Overnight",
  "Paharika Express": "Express", "Udayan Express": "Overnight",
};

const COACH_LABELS = ["ক", "খ", "গ", "ঘ", "ঙ", "চ", "ছ", "জ"];
const COACH_CAPACITIES = [56, 52, 48, 44, 40, 36, 32, 28];
const COACH_TYPES = ["Shuvon Chair", "Shuvon Chair", "Shuvon Chair", "Shuvon Chair", "Snigdha", "Snigdha", "AC Chair", "AC Chair"];
const SEAT_TYPE_CYCLE = ["Window", "Aisle", "Aisle", "Window"];
const TRAIN_SPEEDS_KMH = [52, 68, 56, 64, 60];
const STOP_DWELLS_MINUTES = [10, 6, 8, 5, 7];
const MIN_ROUTE_HEADWAY_MINUTES = 10;

function minuteOfDay(value) { const [h, m] = value.split(":").map(Number); return h * 60 + m; }
function formatTime(minutes) { const normalized = ((minutes % 1440) + 1440) % 1440; return `${String(Math.floor(normalized / 60)).padStart(2,"0")}:${String(normalized % 60).padStart(2,"0")}:00`; }
function trainProfile(index) {
  return { speed: TRAIN_SPEEDS_KMH[index % TRAIN_SPEEDS_KMH.length], dwell: STOP_DWELLS_MINUTES[index % STOP_DWELLS_MINUTES.length] };
}
function elapsedMinutes(route, stopIndex, profile) {
  return Math.round(route.stops[stopIndex][1] / profile.speed * 60 + stopIndex * profile.dwell);
}

function assertNoRouteOverlaps() {
  for (const route of ROUTES) {
    const services = TRAINS.map((train,index) => ({ train,index })).filter(({train}) => train[1] === route.name)
      .map(({train,index}) => ({ name: train[0], start: minuteOfDay(train[2]), duration: elapsedMinutes(route, route.stops.length - 1, trainProfile(index)) }))
      .sort((a, b) => a.start - b.start);
    for (let i = 0; i < services.length; i++) {
      const current = services[i];
      const next = services[(i + 1) % services.length];
      const gap = (next.start - current.start + 1440) % 1440;
      if (services.length > 1 && gap < current.duration + MIN_ROUTE_HEADWAY_MINUTES) {
        throw new Error(`${current.name} overlaps ${next.name} on ${route.name}.`);
      }
    }
  }
}

async function writeTrainSchedule(client, trainId, routeId, route, startTime, profile) {
  await client.query("DELETE FROM train_station_schedule WHERE train_id=$1", [trainId]);
  const start = minuteOfDay(startTime);
  for (let i = 0; i < route.stops.length; i++) {
    const [code] = route.stops[i];
    const arrival = start + elapsedMinutes(route, i, profile);
    const departure = arrival + (i < route.stops.length - 1 ? profile.dwell : 0);
    await client.query(`INSERT INTO train_station_schedule (train_id,route_id,station_code,arrival_time,departure_time)
      VALUES ($1,$2,$3,$4,$5)`, [trainId,routeId,code,formatTime(arrival),formatTime(departure)]);
  }
}

async function syncTrainSchedules(client) {
  assertNoRouteOverlaps();
  for (let i = 0; i < TRAINS.length; i++) {
    const [name, routeName, startTime] = TRAINS[i];
    const train = (await client.query("SELECT train_id FROM train WHERE train_name=$1 ORDER BY train_id LIMIT 1", [name])).rows[0];
    const route = ROUTES.find((item) => item.name === routeName);
    const routeRow = (await client.query("SELECT route_id FROM route WHERE route_name=$1 ORDER BY route_id LIMIT 1", [routeName])).rows[0];
    if (!train || !routeRow) throw new Error(`Cannot schedule ${name}; its train or route record is missing.`);
    await client.query("UPDATE trip SET route_id=$2 WHERE train_id=$1", [train.train_id,routeRow.route_id]);
    await writeTrainSchedule(client,train.train_id,routeRow.route_id,route,startTime,trainProfile(i));
  }
  await client.query(`INSERT INTO trip (train_id,route_id,departure_date,status)
    SELECT tr.train_id, sch.route_id, CURRENT_DATE + d.day_offset, 'scheduled'
    FROM train tr JOIN train_station_schedule sch ON sch.train_id=tr.train_id
    CROSS JOIN generate_series(0,30) d(day_offset)
    WHERE sch.station_code=(SELECT rs.station_code FROM route_station rs WHERE rs.route_id=sch.route_id ORDER BY stop_order LIMIT 1)
    ON CONFLICT (train_id,departure_date) DO UPDATE SET route_id=EXCLUDED.route_id`);
}

async function syncRailNetwork(client) {
  assertNoRouteOverlaps();
  await client.query("ALTER TABLE coach ALTER COLUMN coach_number TYPE VARCHAR(8) USING coach_number::text");
  await client.query("ALTER TABLE route_station ADD COLUMN IF NOT EXISTS distance_km NUMERIC(7,1) NOT NULL DEFAULT 0");
  await client.query("ALTER TABLE train ADD COLUMN IF NOT EXISTS train_category VARCHAR(30) NOT NULL DEFAULT 'Standard'");
  await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_train_departure_unique ON trip (train_id, departure_date)");

  for (const [code, name, city] of STATIONS) {
    await client.query(`INSERT INTO station (station_code,station_name,city) VALUES ($1,$2,$3)
      ON CONFLICT (station_code) DO UPDATE SET station_name=EXCLUDED.station_name, city=EXCLUDED.city`, [code,name,city]);
  }
  const routeIds = new Map();
  for (const route of ROUTES) {
    let existing = (await client.query("SELECT route_id FROM route WHERE route_name=$1 ORDER BY route_id LIMIT 1", [route.name])).rows[0];
    if (!existing) existing = (await client.query("INSERT INTO route (route_name) VALUES ($1) RETURNING route_id", [route.name])).rows[0];
    routeIds.set(route.name, existing.route_id);
  }

  const trainNames = TRAINS.map((item) => item[0]);
  const active = await client.query("SELECT COUNT(*)::int AS count FROM ticket");
  if (active.rows[0].count) throw new Error("Network refresh stopped because ticket records exist. Preserve bookings before changing coach and route data.");
  await client.query("DELETE FROM train WHERE train_name <> ALL($1::text[])", [trainNames]);

  for (const route of ROUTES) {
    const routeId = routeIds.get(route.name);
    await client.query("DELETE FROM train_station_schedule WHERE route_id=$1", [routeId]);
    await client.query("DELETE FROM route_station WHERE route_id=$1", [routeId]);
    for (let i = 0; i < route.stops.length; i++) {
      const [code, km] = route.stops[i];
      await client.query("INSERT INTO route_station (route_id,station_code,stop_order,distance_km) VALUES ($1,$2,$3,$4)", [routeId,code,i+1,km]);
    }
  }
  const routeNames = ROUTES.map((item) => item.name);
  await client.query("DELETE FROM route WHERE route_name <> ALL($1::text[])", [routeNames]);

  for (let trainIndex = 0; trainIndex < TRAINS.length; trainIndex++) {
    const [name, routeName, startTime] = TRAINS[trainIndex];
    const route = ROUTES.find((item) => item.name === routeName);
    const profile = trainProfile(trainIndex);
    const routeId = routeIds.get(routeName);
    let trainResult = (await client.query("SELECT train_id FROM train WHERE train_name=$1 ORDER BY train_id LIMIT 1", [name])).rows[0];
    if (!trainResult) trainResult = (await client.query("INSERT INTO train (train_name) VALUES ($1) RETURNING train_id", [name])).rows[0];
    const trainId = trainResult.train_id;
    await client.query("UPDATE train SET train_category=$2 WHERE train_id=$1", [trainId,TRAIN_CATEGORY_BY_NAME[name] || "Standard"]);
    await client.query("UPDATE trip SET route_id=$2 WHERE train_id=$1", [trainId,routeId]);
    await client.query("DELETE FROM coach WHERE train_id=$1", [trainId]);
    await writeTrainSchedule(client,trainId,routeId,route,startTime,profile);

    for (let i = 0; i < COACH_LABELS.length; i++) {
      const label = COACH_LABELS[i];
      const coach = await client.query(`INSERT INTO coach (train_id,coach_number,coach_type,capacity) VALUES ($1,$2,$3,$4)
        ON CONFLICT (train_id,coach_number) DO UPDATE SET coach_type=EXCLUDED.coach_type,capacity=EXCLUDED.capacity
        RETURNING coach_id`, [trainId,label,COACH_TYPES[i],COACH_CAPACITIES[i]]);
      const coachId = coach.rows[0].coach_id;
      await client.query("DELETE FROM seat WHERE coach_id=$1 AND seat_number::int > $2", [coachId,COACH_CAPACITIES[i]]);
      for (let seat = 1; seat <= COACH_CAPACITIES[i]; seat++) {
        await client.query(`INSERT INTO seat (coach_id,seat_number,seat_type) VALUES ($1,$2,$3)
          ON CONFLICT (coach_id,seat_number) DO UPDATE SET seat_type=EXCLUDED.seat_type`, [coachId,String(seat).padStart(2,"0"),SEAT_TYPE_CYCLE[(seat-1)%4]]);
      }
    }
  }
  const duplicateRoute = await client.query(`SELECT r.route_name, a.train_id, b.train_id FROM train_station_schedule a
    JOIN train_station_schedule b ON b.route_id=a.route_id AND b.station_code=a.station_code AND b.train_id>a.train_id
    JOIN route r ON r.route_id=a.route_id WHERE a.departure_time=b.departure_time`);
  if (duplicateRoute.rowCount) throw new Error("Two trains share the same route departure time.");
  await client.query(`INSERT INTO trip (train_id,route_id,departure_date,status)
    SELECT tr.train_id, sch.route_id, CURRENT_DATE + d.day_offset, 'scheduled'
    FROM train tr JOIN train_station_schedule sch ON sch.train_id=tr.train_id
    CROSS JOIN generate_series(0,30) d(day_offset)
    WHERE sch.station_code=(SELECT rs.station_code FROM route_station rs WHERE rs.route_id=sch.route_id ORDER BY stop_order LIMIT 1)
    ON CONFLICT (train_id,departure_date) DO UPDATE SET route_id=EXCLUDED.route_id`);
}

module.exports = { STATIONS, ROUTES, TRAINS, TRAIN_CATEGORY_BY_NAME, syncRailNetwork, syncTrainSchedules, assertNoRouteOverlaps };
