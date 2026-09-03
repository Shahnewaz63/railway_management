// Runs a SQL file with DATABASE_URL from .env, so psql receives the same
// connection settings as the server and seed scripts.
require("dotenv").config();
const { spawnSync } = require("child_process");
const path = require("path");

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
  console.error(`Could not run psql: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
