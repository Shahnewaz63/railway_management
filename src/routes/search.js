const router = require("express").Router();
const { searchTrains } = require("../services/train-search");

router.get("/", async (req, res, next) => {
  try {
    res.json(await searchTrains({
      from: req.query.from,
      to: req.query.to,
      date: req.query.date,
      klass: req.query.klass,
    }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
