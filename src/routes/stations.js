const router = require("express").Router();
const pool = require("../db/pool");

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT station_code, station_name, city FROM station ORDER BY station_name");
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
