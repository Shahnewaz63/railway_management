// The schema has no fare/class table — `coach_type` IS the class, and price
// is a configurable, application-level constant (per the spec, §44) rather
// than a fabricated database field.

const FARES = {
  "Shuvon Chair": 90,
  "Snigdha": 150,
  "AC Chair": 200,
};

const FARE_PER_KM = { "Shuvon Chair": 1.15, Snigdha: 1.9, "AC Chair": 2.5 };
const TRAIN_CATEGORY_MULTIPLIERS = { Standard: 0.9, Express: 1, Overnight: 1.08, Premium: 1.2, Business: 1.3 };

function calculateFare(distanceKm, coachType, trainCategory = "Standard") {
  const distance = Number(distanceKm);
  const rate = FARE_PER_KM[coachType];
  const categoryFactor = TRAIN_CATEGORY_MULTIPLIERS[trainCategory] ?? TRAIN_CATEGORY_MULTIPLIERS.Standard;
  return Number.isFinite(distance) && distance > 0 && rate ? Math.ceil((distance * rate * categoryFactor) / 10) * 10 : null;
}

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

module.exports = { FARES, FARE_PER_KM, TRAIN_CATEGORY_MULTIPLIERS, calculateFare, CLASS_INFO, HOLD_MINUTES };
