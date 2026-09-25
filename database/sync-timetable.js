require("dotenv").config();
const pool = require("../src/db/pool");
const { syncTrainSchedules } = require("./network");
(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await syncTrainSchedules(client);
    await client.query("COMMIT");
    console.log("Updated train-specific running times without changing tickets or coaches.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Timetable update failed; changes rolled back:", error.message);
    process.exitCode = 1;
  } finally { client.release(); await pool.end(); }
})();
