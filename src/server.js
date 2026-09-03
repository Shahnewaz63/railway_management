require("dotenv").config();
const app = require("./app");
const pool = require("./db/pool");
const { HOLD_MINUTES } = require("./config/fares");

const PORT = process.env.PORT || 3000;

// Belt-and-suspenders: every request that reads a booking already computes
// its effective status live, but this sweep also flips the stored
// booking_status column so it reflects reality even for rows nobody reads.
setInterval(async () => {
  try {
    await pool.query(
      `UPDATE booking SET booking_status = 'expired'
       WHERE booking_status = 'pending' AND now() - booking_date >= interval '${HOLD_MINUTES} minutes'`
    );
  } catch (err) {
    console.error("[expiry-sweep] failed:", err.message);
  }
}, 15000);

app.listen(PORT, () => {
  console.log(`BD Railway server running on http://localhost:${PORT}`);
});
