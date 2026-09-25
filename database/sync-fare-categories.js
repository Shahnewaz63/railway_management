require("dotenv").config();
const pool = require("../src/db/pool");
const { TRAIN_CATEGORY_BY_NAME } = require("./network");
(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("ALTER TABLE train ADD COLUMN IF NOT EXISTS train_category VARCHAR(30) NOT NULL DEFAULT 'Standard'");
    for (const [name, category] of Object.entries(TRAIN_CATEGORY_BY_NAME)) {
      await client.query("UPDATE train SET train_category=$2 WHERE train_name=$1", [name,category]);
    }
    await client.query("COMMIT");
    console.log("Train fare categories updated.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Category update failed; changes rolled back:", error.message);
    process.exitCode = 1;
  } finally { client.release(); await pool.end(); }
})();
