const MAX_POSTGRES_INTEGER = 2147483647;
const MAX_PASSENGER_AGE = 120;
const MAX_PASSENGER_NAME_LENGTH = 100;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// IDs are PostgreSQL INT values in this schema. Keep parsing deliberately
// strict so values such as 1.5, true, "1e3", and out-of-range numbers never
// reach a query or an advisory lock.
function parsePositiveId(value) {
  let parsed;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    parsed = Number(value);
  } else {
    return null;
  }

  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_POSTGRES_INTEGER ? parsed : null;
}

function normalizeStationCode(value) {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9]{1,10}$/.test(code) ? code : null;
}

function parseIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const [year, month, day] = value.split("-").map(Number);
  if (year < 1) return null;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
}

function parseOptionalEnum(value, allowedValues) {
  if (value === undefined) return { valid: true, value: null };
  if (typeof value !== "string") return { valid: false, value: null };

  const normalized = value.trim();
  return allowedValues.includes(normalized)
    ? { valid: true, value: normalized }
    : { valid: false, value: null };
}

function normalizePassengerName(value) {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!name || Array.from(name).length > MAX_PASSENGER_NAME_LENGTH) return null;
  return /[\u0000-\u001F\u007F]/u.test(name) ? null : name;
}

function parsePassengerAge(value) {
  const age = parsePositiveId(value);
  return age !== null && age <= MAX_PASSENGER_AGE ? age : null;
}

function normalizePnr(value) {
  if (typeof value !== "string") return null;
  const pnr = value.trim().toUpperCase();
  return /^PNR[A-HJ-NP-Z2-9]{7}$/.test(pnr) ? pnr : null;
}

module.exports = {
  isPlainObject,
  parsePositiveId,
  normalizeStationCode,
  parseIsoDate,
  parseOptionalEnum,
  normalizePassengerName,
  parsePassengerAge,
  normalizePnr,
};
