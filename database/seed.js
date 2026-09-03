// Populates the schema with reference data (stations, routes, trains,
// coaches, seats, trips) and one demo user. Safe to re-run: it truncates
// and rebuilds everything.
//
// Usage:  npm run seed   (reads DATABASE_URL from .env)

require("dotenv").config();
const bcrypt = require("bcrypt");
const pool = require("../src/db/pool");

const STATIONS = [
  ["DHK", "Dhaka Kamalapur Railway Station", "Dhaka"],
  ["CTG", "Chittagong Railway Station", "Chittagong"],
  ["SYL", "Sylhet Railway Station", "Sylhet"],
  ["RAJ", "Rajshahi Railway Station", "Rajshahi"],
  ["KHL", "Khulna Railway Station", "Khulna"],
  ["BSL", "Bhairab Bazar Railway Station", "Bhairab"],
  ["AKR", "Akhaura Railway Station", "Akhaura"],
];

const ROUTE_DEFS = [
  { name: "Dhaka - Chittagong Main Line", stops: [["DHK", 1], ["AKR", 2], ["CTG", 3]] },
  { name: "Dhaka - Sylhet Line", stops: [["DHK", 1], ["BSL", 2], ["SYL", 3]] },
  { name: "Dhaka - Rajshahi Line", stops: [["DHK", 1], ["RAJ", 2]] },
  { name: "Dhaka - Khulna Line", stops: [["DHK", 1], ["KHL", 2]] },
];

const TRAIN_DEFS = [
  {
    name: "Subarna Express",
    route: "Dhaka - Chittagong Main Line",
    coaches: [
      { number: 1, type: "Shuvon Chair", capacity: 60 },
      { number: 2, type: "Shuvon Chair", capacity: 60 },
      { number: 3, type: "Snigdha", capacity: 44 },
      { number: 4, type: "AC Chair", capacity: 36 },
    ],
  },
  {
    name: "Mohanagar Godhuli",
    route: "Dhaka - Chittagong Main Line",
    coaches: [
      { number: 1, type: "Shuvon Chair", capacity: 60 },
      { number: 2, type: "Snigdha", capacity: 44 },
    ],
  },
  {
    name: "Parabat Express",
    route: "Dhaka - Sylhet Line",
    coaches: [
      { number: 1, type: "Shuvon Chair", capacity: 55 },
      { number: 2, type: "Snigdha", capacity: 40 },
      { number: 3, type: "AC Chair", capacity: 30 },
    ],
  },
  {
    name: "Silk City Express",
    route: "Dhaka - Rajshahi Line",
    coaches: [
      { number: 1, type: "Shuvon Chair", capacity: 58 },
      { number: 2, type: "Snigdha", capacity: 42 },
    ],
  },
  {
    name: "Sundarban Express",
    route: "Dhaka - Khulna Line",
    coaches: [
      { number: 1, type: "Shuvon Chair", capacity: 58 },
      { number: 2, type: "Snigdha", capacity: 42 },
      { number: 3, type: "AC Chair", capacity: 32 },
    ],
  },
];

const SEAT_TYPE_CYCLE = ["Window", "Aisle", "Aisle", "Window"];
const TRIP_DAYS_AHEAD = 21;

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    console.log("Clearing existing data...");
    await client.query(
      `TRUNCATE payment, ticket, booking, user_auth, users, seat, coach, trip, route_station, train, route, station RESTART IDENTITY CASCADE`
    );

    console.log("Seeding stations...");
    for (const [code, name, city] of STATIONS) {
      await client.query("INSERT INTO station (station_code, station_name, city) VALUES ($1,$2,$3)", [code, name, city]);
    }

    console.log("Seeding routes...");
    const routeIds = {};
    for (const r of ROUTE_DEFS) {
      const res = await client.query("INSERT INTO route (route_name) VALUES ($1) RETURNING route_id", [r.name]);
      routeIds[r.name] = res.rows[0].route_id;
      for (const [code, order] of r.stops) {
        await client.query("INSERT INTO route_station (route_id, station_code, stop_order) VALUES ($1,$2,$3)", [
          routeIds[r.name],
          code,
          order,
        ]);
      }
    }

    console.log("Seeding trains, coaches and seats...");
    const trains = [];
    for (const td of TRAIN_DEFS) {
      const tRes = await client.query("INSERT INTO train (train_name) VALUES ($1) RETURNING train_id", [td.name]);
      const train_id = tRes.rows[0].train_id;
      trains.push({ train_id, route_id: routeIds[td.route] });

      for (const c of td.coaches) {
        const cRes = await client.query(
          "INSERT INTO coach (train_id, coach_number, coach_type, capacity) VALUES ($1,$2,$3,$4) RETURNING coach_id",
          [train_id, c.number, c.type, c.capacity]
        );
        const coach_id = cRes.rows[0].coach_id;
        for (let i = 0; i < c.capacity; i++) {
          const seat_number = String(i + 1).padStart(2, "0");
          const seat_type = SEAT_TYPE_CYCLE[i % 4];
          await client.query("INSERT INTO seat (coach_id, seat_number, seat_type) VALUES ($1,$2,$3)", [
            coach_id,
            seat_number,
            seat_type,
          ]);
        }
      }
    }

    console.log(`Seeding trips (next ${TRIP_DAYS_AHEAD} days)...`);
    for (let dayOffset = 0; dayOffset < TRIP_DAYS_AHEAD; dayOffset++) {
      for (const tr of trains) {
        await client.query(
          `INSERT INTO trip (train_id, route_id, departure_date, status)
           VALUES ($1, $2, CURRENT_DATE + $3::int, 'scheduled')`,
          [tr.train_id, tr.route_id, dayOffset]
        );
      }
    }

    console.log("Seeding demo customer (rahim@example.com / password123)...");
    const uRes = await client.query(
      "INSERT INTO users (first_name, last_name, email, role) VALUES ($1,$2,$3,'customer') RETURNING user_id",
      ["Rahim", "Uddin", "rahim@example.com"]
    );
    const hash = await bcrypt.hash("password123", 10);
    await client.query("INSERT INTO user_auth (user_id, password_hash) VALUES ($1,$2)", [uRes.rows[0].user_id, hash]);

    console.log("Seeding demo admin (admin@example.com / admin123)...");
    const adminRes = await client.query(
      "INSERT INTO users (first_name, last_name, email, role) VALUES ($1,$2,$3,'admin') RETURNING user_id",
      ["Admin", "User", "admin@example.com"]
    );
    const adminHash = await bcrypt.hash("admin123", 10);
    await client.query("INSERT INTO user_auth (user_id, password_hash) VALUES ($1,$2)", [adminRes.rows[0].user_id, adminHash]);

    await client.query("COMMIT");
    console.log("Seed complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
