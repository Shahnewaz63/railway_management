// The schema has no fare/class table — `coach_type` IS the class, and price
// is a configurable, application-level constant (per the spec, §44) rather
// than a fabricated database field.

const FARES = {
  "Shuvon Chair": 350,
  "Snigdha": 660,
  "AC Chair": 790,
};

const CLASS_INFO = {
  "Shuvon Chair": {
    seatType: "Upright cushioned chair",
    comfort: "Standard",
    ac: "Non-AC",
    use: "Short and medium distance day travel at the lowest fare.",
  },
  "Snigdha": {
    seatType: "Reclining chair",
    comfort: "High",
    ac: "AC",
    use: "Medium and long distance travel with extra legroom and comfort.",
  },
  "AC Chair": {
    seatType: "Reclining chair, wider pitch",
    comfort: "Premium",
    ac: "AC",
    use: "Long distance and overnight journeys for a premium experience.",
  },
};

const HOLD_MINUTES = 5;

module.exports = { FARES, CLASS_INFO, HOLD_MINUTES };
