require("dotenv").config();
const pool = require("../src/db/pool");
const { syncRailNetwork } = require("./network");
(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await syncRailNetwork(client);
    await client.query("COMMIT");
    console.log("Rail network, timetable, coaches and variable seats updated.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Network update failed; changes rolled back:", error.message);
    process.exitCode = 1;
  } finally { client.release(); await pool.end(); }
})();
