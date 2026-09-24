// Runs a SQL file with DATABASE_URL from .env, so psql receives the same
// connection settings as the server and seed scripts.
require("dotenv").config();
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const sqlFile = process.argv[2];
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to .env before running this command.");
  process.exit(1);
}
if (!sqlFile) {
  console.error("Usage: node database/run-sql.js <sql-file>");
  process.exit(1);
}

const result = spawnSync(
  "psql",
  [process.env.DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-f", path.resolve(sqlFile)],
  { stdio: "inherit" }
);

if (result.error) {
  if (result.error.code !== "ENOENT") {
    console.error(`Could not run psql: ${result.error.message}`);
    process.exit(1);
  }
  // Keep migrations usable on systems with the app's PostgreSQL driver but
  // without the optional psql command line client.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false } });
  pool.query(fs.readFileSync(path.resolve(sqlFile), "utf8"))
    .then(() => console.log(`Applied ${path.basename(sqlFile)}.`))
    .catch((err) => { console.error(`Could not apply ${path.basename(sqlFile)}: ${err.message}`); process.exitCode = 1; })
    .finally(() => pool.end());
}
if (!result.error) process.exit(result.status ?? 1);
