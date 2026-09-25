require("dotenv").config();
const app = require("./app");
const pool = require("./db/pool");
const { HOLD_MINUTES } = require("./config/fares");

const PORT = process.env.PORT || 3000;

// Persist expiration through the database maintenance procedure. Reads also
// compute effective status live, so holds remain accurate between sweeps.
setInterval(async () => {
  try {
    await pool.query("CALL run_booking_maintenance($1)", [HOLD_MINUTES]);
  } catch (err) {
    console.error("[expiry-sweep] failed:", err.message);
  }
}, 15000);

app.listen(PORT, () => {
  console.log(`BD Railway server running on http://localhost:${PORT}`);
});
