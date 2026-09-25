// Rebuilds all application data, including users and bookings. Use database/sync-network.js
// when updating only the rail network in a database that already contains customer data.
require("dotenv").config();
const bcrypt = require("bcrypt");
const pool = require("../src/db/pool");
const { syncRailNetwork } = require("./network");

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`TRUNCATE contact_message, payment, ticket_refund, ticket, booking, user_auth, auth_session, password_reset_otp, users, seat, coach, trip, train_station_schedule, route_station, train, route, station RESTART IDENTITY CASCADE`);
    await syncRailNetwork(client);
    const customer = await client.query("INSERT INTO users (first_name,last_name,email,role) VALUES ('Rahim','Uddin','rahim@example.com','customer') RETURNING user_id");
    await client.query("INSERT INTO user_auth (user_id,password_hash) VALUES ($1,$2)", [customer.rows[0].user_id, await bcrypt.hash("password123",10)]);
    const admin = await client.query("INSERT INTO users (first_name,last_name,email,role) VALUES ('Admin','User','admin@example.com','admin') RETURNING user_id");
    await client.query("INSERT INTO user_auth (user_id,password_hash) VALUES ($1,$2)", [admin.rows[0].user_id, await bcrypt.hash("admin123",10)]);
    await client.query("COMMIT");
    console.log("Seed complete.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", error.message);
    process.exitCode = 1;
  } finally { client.release(); await pool.end(); }
}
run();
