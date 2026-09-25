const router = require("express").Router();
const pool = require("../db/pool");
const { FARE_PER_KM, TRAIN_CATEGORY_MULTIPLIERS, calculateFare } = require("../config/fares");
const { searchTrains } = require("../services/train-search");

const MODEL = "gemini-3.5-flash-lite";
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 12;
const requestWindows = new Map();
const COACH_TYPES = ["Shuvon Chair", "Snigdha", "AC Chair"];
const INTENTS = ["GENERAL_RAILWAY_QUERY", "TRAIN_SEARCH", "JOURNEY_PLANNING", "FARE_QUERY", "SCHEDULE_QUERY"];

function localToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function timeMinutes(value) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function customerUsesBangla(message) {
  return /[\u0980-\u09FF]/.test(message)
    || /\b(ami|amar|chai|jabo|theke|kibhabe|korbo|dekhao|lagbe|kobe|tarikh|dorkar|hobe|dekhte|bujhte)\b/i.test(message);
}

function resultReply(intent, data, bangla) {
  if (!data) return "";
  if (data.type === "trains") {
    if (!data.items.length) return bangla ? "আপনার শর্ত অনুযায়ী কোনো ট্রেন পাওয়া যায়নি। সময় বা তারিখ পরিবর্তন করে দেখতে চান?" : "I couldn't find a train matching those requirements. Would you like to try another time or date?";
    return bangla ? `আপনার শর্ত অনুযায়ী ${data.items.length}টি ট্রেন পাওয়া গেছে। কোন ট্রেন ও শ্রেণি বেছে নেবেন?` : `I found ${data.items.length} trains matching your requirements. Which train and class would you like?`;
  }
  if (data.type === "fares") return bangla ? `${data.passengers} জন যাত্রীর জন্য শ্রেণিভিত্তিক ভাড়া ও মোট নিচে দেওয়া হলো। অন্য যাত্রীসংখ্যার হিসাব চান?` : data.distance_km ? `Here are the distance-based fares for ${data.distance_km} km and ${data.passengers} passenger${data.passengers === 1 ? "" : "s"}.` : "Fares depend on journey distance. Tell me your departure and destination stations for a trip total.";
  if (data.type === "schedules") {
    if (!data.items.length) return bangla ? "এই স্টেশন ও রুটের জন্য কোনো প্রকাশিত সময়সূচি পাওয়া যায়নি। অন্য স্টেশন খুঁজবেন?" : "I couldn't find a published schedule for that station and route. Would you like another station?";
    return bangla ? `প্রকাশিত সময়সূচিতে ${data.items.length}টি মিল পাওয়া গেছে। কোন ট্রেনের বিস্তারিত দেখতে চান?` : `I found ${data.items.length} matching published schedules. Which train would you like details for?`;
  }
  return "";
}

function routeTime(value) {
  const match = String(value || "").match(/T(\d{2}:\d{2})/);
  return match?.[1] || null;
}

function travelDurationMinutes(trip) {
  const start = new Date(trip.origin_departure).getTime();
  const end = new Date(trip.destination_arrival).getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 60000)) : null;
}

function resolveStationCode(value, stations) {
  if (typeof value !== "string" || !value.trim()) return null;
  const input = value.trim().toLocaleLowerCase();
  const direct = stations.find((item) => item.station_code.toLowerCase() === input);
  if (direct) return direct.station_code;
  const aliases = { chattogram: "chattogram", chittagong: "chattogram", ctg: "chattogram", dhaka: "dhaka", dhk: "dhaka", sylhet: "sylhet", rajshahi: "rajshahi" };
  const canonical = aliases[input] || input;
  const match = stations.find((item) => item.city.toLocaleLowerCase() === canonical
    || item.station_name.toLocaleLowerCase() === canonical
    || item.station_name.toLocaleLowerCase().startsWith(`${canonical} `));
  return match?.station_code || null;
}

async function findSchedule({ origin, destination, trainName }) {
  const params = [];
  const clauses = [];
  if (origin) { params.push(origin); clauses.push(`origin.station_code = $${params.length}`); }
  if (destination) { params.push(destination); clauses.push(`destination.station_code = $${params.length}`); }
  if (trainName) { params.push(`%${trainName}%`); clauses.push(`tr.train_name ILIKE $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT tr.train_id, tr.train_name, rs_from.station_code AS origin_code,
            origin.city AS origin_city,
            sf.departure_time AS origin_departure_time, rs_to.station_code AS destination_code,
            destination.city AS destination_city,
            st.arrival_time AS destination_arrival_time,
            json_agg(json_build_object('station_code', stops.station_code, 'city', stops.city,
              'arrival_time', stops.arrival_time, 'departure_time', stops.departure_time)
              ORDER BY stops.stop_order) AS stops
     FROM train tr
     JOIN train_station_schedule sf ON sf.train_id = tr.train_id
     JOIN route_station rs_from ON rs_from.route_id = sf.route_id AND rs_from.station_code = sf.station_code
     JOIN station origin ON origin.station_code = rs_from.station_code
     JOIN train_station_schedule st ON st.train_id = tr.train_id AND st.route_id = sf.route_id
     JOIN route_station rs_to ON rs_to.route_id = st.route_id AND rs_to.station_code = st.station_code
     JOIN station destination ON destination.station_code = rs_to.station_code
     LEFT JOIN LATERAL (
       SELECT rs.stop_order, rs.station_code, s.city, sch.arrival_time, sch.departure_time
       FROM route_station rs JOIN station s ON s.station_code = rs.station_code
       JOIN train_station_schedule sch ON sch.train_id = tr.train_id AND sch.route_id = rs.route_id AND sch.station_code = rs.station_code
       WHERE rs.route_id = sf.route_id AND rs.stop_order BETWEEN rs_from.stop_order AND rs_to.stop_order
     ) stops ON true
     WHERE ${clauses.length ? clauses.join(" AND ") : "true"}
       AND rs_from.stop_order < rs_to.stop_order
       AND ($${params.length + 1}::boolean OR rs_to.stop_order = (
         SELECT MAX(last_stop.stop_order) FROM route_station last_stop WHERE last_stop.route_id = sf.route_id
       ))
     GROUP BY tr.train_id, tr.train_name, rs_from.station_code, origin.city, sf.departure_time,
              rs_to.station_code, destination.city, st.arrival_time, rs_from.stop_order
     ORDER BY sf.departure_time`, [...params, Boolean(destination)]
  );
  return rows;
}

async function buildAssistantData(intent, query, stations) {
  const origin = resolveStationCode(query.origin, stations);
  const destination = resolveStationCode(query.destination, stations);
  const hasOrigin = typeof query.origin === "string" && query.origin.trim();
  const hasDestination = typeof query.destination === "string" && query.destination.trim();
  if (hasOrigin && !origin) return { error: `I couldn't match “${query.origin}” to a station. Available cities include ${stations.map((item) => item.city).join(", ")}.` };
  if (hasDestination && !destination) return { error: `I couldn't match “${query.destination}” to a station. Available cities include ${stations.map((item) => item.city).join(", ")}.` };

  if (intent === "TRAIN_SEARCH" || intent === "JOURNEY_PLANNING" || (intent === "SCHEDULE_QUERY" && origin && destination && query.date)) {
    if (!origin) return { error: "Where will you be travelling from?" };
    if (!destination) return { error: "Where would you like to travel to?" };
    if (!query.date) return { error: "What date would you like to travel?" };
    const date = /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : null;
    if (!date) return { error: "What travel date should I search? Please give a date such as tomorrow or 2026-10-15." };
    let items;
    try {
      items = await searchTrains({ from: origin, to: destination, date, klass: query.coach || undefined });
    } catch (error) {
      if (error.status) return { error: error.message };
      throw error;
    }
    if (query.train_name) items = items.filter((item) => item.train_name.toLowerCase().includes(query.train_name.toLowerCase()));
    items = constrainTrips(items, query);
    return { data: {
      type: "trains",
      items: items.slice(0, 12),
      passengers: Number.isInteger(query.passengers) && query.passengers > 0 ? query.passengers : 1,
      criteria: journeyFilters(query),
    } };
  }

  if (intent === "FARE_QUERY") {
    let trainRows = [];
    if (query.train_name) {
      const result = await pool.query("SELECT train_id, train_name, train_category FROM train WHERE train_name ILIKE $1 ORDER BY train_name", [`%${query.train_name}%`]);
      trainRows = result.rows;
      if (!trainRows.length) return { error: `I couldn't find a train named “${query.train_name}” in the timetable.` };
    }
    const { rows: classes } = await pool.query("SELECT DISTINCT coach_type FROM coach ORDER BY coach_type");
    const passengers = Number.isInteger(query.passengers) && query.passengers > 0 ? Math.min(query.passengers, 100) : 1;
    let distanceKm = null;
    if (origin && destination) {
      const routeFare = await pool.query(`SELECT (to_stop.distance_km-from_stop.distance_km) AS distance_km
        FROM route_station from_stop JOIN route_station to_stop ON to_stop.route_id=from_stop.route_id
        JOIN route r ON r.route_id=from_stop.route_id
        WHERE from_stop.station_code=$1 AND to_stop.station_code=$2 AND from_stop.stop_order<to_stop.stop_order
        ORDER BY distance_km LIMIT 1`, [origin,destination]);
      if (!routeFare.rowCount) return { error: "I couldn't find a direct fare route between those stations." };
      distanceKm = Number(routeFare.rows[0].distance_km);
    }
    let items = classes.rows || classes;
    const fareCategory = trainRows[0]?.train_category || "Standard";
    items = items.map((row) => ({ coach_type: row.coach_type,
      fare: distanceKm ? calculateFare(distanceKm,row.coach_type,fareCategory) : null,
      fare_per_km: FARE_PER_KM[row.coach_type] == null ? null : FARE_PER_KM[row.coach_type] * (TRAIN_CATEGORY_MULTIPLIERS[fareCategory] || 1) }))
      .filter((item) => !query.coach || item.coach_type.toLowerCase() === query.coach.toLowerCase());
    if (!items.length || items.every((item) => item.fare_per_km == null)) return { error: "Fare information is unavailable for that class." };
    return { data: { type: "fares", passengers, distance_km: distanceKm, fare_category: fareCategory, trains: trainRows,
      items: items.map((item) => ({ ...item, total: item.fare == null ? null : item.fare * passengers })) } };
  }

  if (intent === "SCHEDULE_QUERY") {
    if (!origin) return { error: "Which station should I check departures from?" };
    let items = await findSchedule({ origin, destination, trainName: query.train_name });
    const departureAfter = timeMinutes(query.departure_after);
    const departureBefore = timeMinutes(query.departure_before);
    const arrivalAfter = timeMinutes(query.arrival_after);
    const arrivalBefore = timeMinutes(query.arrival_before);
    items = items.filter((item) => {
      const departure = timeMinutes(item.origin_departure_time);
      const arrival = timeMinutes(item.destination_arrival_time);
      return (departureAfter === null || departure >= departureAfter)
        && (departureBefore === null || departure <= departureBefore)
        && (arrivalAfter === null || arrival >= arrivalAfter)
        && (arrivalBefore === null || arrival <= arrivalBefore);
    });
    if (query.preference === "latest") items.sort((a, b) => b.origin_departure_time.localeCompare(a.origin_departure_time));
    else if (query.preference === "earliest") items.sort((a, b) => a.origin_departure_time.localeCompare(b.origin_departure_time));
    if (!items.length) return { data: { type: "schedules", items: [] } };
    return { data: { type: "schedules", items: items.slice(0, 12).map((item) => ({
      ...item,
      duration_minutes: (timeMinutes(item.destination_arrival_time) - timeMinutes(item.origin_departure_time) + 1440) % 1440,
    })) } };
  }
  return { data: null };
}

function constrainTrips(trips, query) {
  const after = timeMinutes(query.departure_after);
  const before = timeMinutes(query.departure_before);
  const arrivalAfter = timeMinutes(query.arrival_after);
  const arrivalBefore = timeMinutes(query.arrival_before);
  let result = trips.map((trip) => {
    const classes = (trip.classes || []).filter((item) => item.available > 0
      && (query.coach == null || item.coach_type.toLowerCase() === String(query.coach).toLowerCase())
      && (query.max_fare == null || (item.fare != null && item.fare <= query.max_fare))
      && (query.passengers == null || item.available >= query.passengers));
    return { ...trip, classes, duration_minutes: travelDurationMinutes(trip) };
  }).filter((trip) => {
    if (!trip.classes.length) return false;
    const departure = timeMinutes(routeTime(trip.origin_departure));
    const arrival = timeMinutes(routeTime(trip.destination_arrival));
    if (after !== null && departure < after) return false;
    if (before !== null && departure > before) return false;
    if (arrivalAfter !== null && arrival < arrivalAfter) return false;
    if (arrivalBefore !== null && arrival > arrivalBefore) return false;
    if (query.max_duration_minutes != null && trip.duration_minutes > query.max_duration_minutes) return false;
    if (query.overnight_allowed === false && trip.origin_departure.slice(0, 10) !== trip.destination_arrival.slice(0, 10)) return false;
    return true;
  });
  if (query.preference === "cheapest") result.sort((a, b) => Math.min(...a.classes.map((item) => item.fare ?? Infinity)) - Math.min(...b.classes.map((item) => item.fare ?? Infinity)));
  else if (query.preference === "fastest") result.sort((a, b) => a.duration_minutes - b.duration_minutes);
  else if (query.preference === "earliest") result.sort((a, b) => a.origin_departure.localeCompare(b.origin_departure));
  else if (query.preference === "latest") result.sort((a, b) => b.origin_departure.localeCompare(a.origin_departure));
  return result;
}

function journeyFilters(query) {
  return {
    departure_after: query.departure_after || null,
    departure_before: query.departure_before || null,
    arrival_after: query.arrival_after || null,
    arrival_before: query.arrival_before || null,
    max_duration_minutes: Number.isInteger(query.max_duration_minutes) ? query.max_duration_minutes : null,
    passengers: Number.isInteger(query.passengers) ? query.passengers : null,
    max_fare: typeof query.max_fare === "number" ? query.max_fare : null,
    preference: ["cheapest", "fastest", "earliest", "latest"].includes(query.preference) ? query.preference : null,
    overnight_allowed: typeof query.overnight_allowed === "boolean" ? query.overnight_allowed : null,
  };
}

function allowRequest(key) {
  const now = Date.now();
  const window = requestWindows.get(key);
  if (!window || now - window.startedAt >= WINDOW_MS) {
    requestWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (window.count >= MAX_REQUESTS) return false;
  window.count += 1;
  return true;
}

router.post("/chat", async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: "The AI assistant is not configured yet. Add GEMINI_API_KEY to the server environment." });
  }
  if (!allowRequest(req.ip)) return res.status(429).json({ error: "Please wait a moment before sending another message." });

  const messages = req.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 10) {
    return res.status(400).json({ error: "Send up to 10 recent chat messages." });
  }
  const conversation = messages.filter((item) =>
    item && ["user", "assistant"].includes(item.role) && typeof item.content === "string"
  ).map((item) => ({ role: item.role, content: item.content.trim().slice(0, 1200) })).filter((item) => item.content);
  if (!conversation.length || conversation[conversation.length - 1].role !== "user") {
    return res.status(400).json({ error: "Your latest message must be from you." });
  }

  try {
    const { rows: stations } = await pool.query(
      "SELECT station_code, station_name, city FROM station ORDER BY station_name"
    );
    const bangladeshToday = localToday();
    const requestedPage = typeof req.body?.page === "string" ? req.body.page : "home";
    const currentPage = ["home", "results", "coach", "seats", "passenger", "payment", "ticket", "mybookings", "verify", "contact", "status"].includes(requestedPage) ? requestedPage : "home";
    const availableOptions = Array.isArray(req.body?.options)
      ? req.body.options.slice(0, 50).filter((item) => item && typeof item.label === "string")
        .map((item) => ({ type: String(item.type || "").slice(0, 20), label: item.label.trim().slice(0, 120) }))
        .filter((item) => item.label)
      : [];
    const pageGuidance = {
      home: "Help choose origin, destination, journey date, and optionally class before searching.",
      results: "Explain that the customer should choose one listed train and one available class; then coach selection opens.",
      coach: "Explain that the customer should choose one of the displayed coaches for the selected class.",
      seats: "Explain available, selected, and unavailable seats; the customer may choose up to five available seats, then continue.",
      passenger: "Explain that the customer enters each passenger's name and age in the form fields, then continues to payment. Do not ask them to send personal details in chat.",
      payment: "Explain the displayed payment method choices and the remaining time on the seat hold; ask which method they want to use.",
      ticket: "Explain that the customer can review booking, passenger, seat, and payment details, then open My Bookings or start another search.",
      mybookings: "Explain that the customer can choose an upcoming or past booking to open its details.",
      verify: "Ask the customer to enter the ticket PNR and booking email in the verification form.",
      contact: "Explain that the customer can enter a subject and message in Contact Us, then submit it.",
      status: "Explain that the timetable shows published train times and ask which route or date they want to check. Live location is unavailable.",
    }[currentPage] || "Explain the choices shown on the current page and ask which one the customer wants to select.";
    const instructions = [
      "You are RailX BD's friendly customer support assistant for rail passengers in Bangladesh.",
      "Reply in the same language as the customer: use Bangla script for Bangla messages and English for English messages; be concise and welcoming.",
      "Always match the language of the customer's latest message. Use Bangla script for Bangla messages and English for English messages. Do not switch languages unless the customer does.",
      "In every reply, explain the choices relevant to the customer's current step, explain what choosing one does next, and finish with one clear question asking them to choose or provide missing information.",
      "Do not call yourself a demo assistant or describe the service as a demo or prototype.",
      "Help explain how to search trains, choose a class/coach/seat, enter passenger details, pay, verify tickets, and find bookings.",
      "Never claim a train runs, a seat is available, a fare is current, or a booking was made. The app search is the source of truth for schedules and live availability.",
      "When a clear origin and destination are given without a date, ask which date they want and return the journey with date null. When the date is provided, return the journey so the app can open matching train results automatically.",
      "Classify each message as GENERAL_RAILWAY_QUERY, TRAIN_SEARCH, JOURNEY_PLANNING, FARE_QUERY, or SCHEDULE_QUERY. Understand English, Bangla script, and Banglish. Use only station codes from the supplied station list.",
      "Use prior user and assistant turns as conversation context. Merge follow-up details such as a station, date, time, class, or passenger count with the active route/train request. For references such as 'which one is cheapest', use the previous verified result context and re-query/sort actual data rather than guessing.",
      "For train search/planning and schedule queries, extract route, date, departure and arrival time limits, passenger count, class, maximum fare, overnight preference, and sort preference. Convert today/tomorrow/tonight/next weekdays and relative times to Asia/Dhaka absolute YYYY-MM-DD and HH:MM values using the supplied local date. Morning means 05:00-12:00, afternoon 12:00-17:00, evening 17:00-21:00, and tonight 17:00-23:59. For 'last train' or 'latest departure', use sort preference latest.",
      "For fare questions extract class, optional train and passenger count. For schedule questions extract train, origin and optional destination/date. Ask only for required missing information; a fare query needs a class or train, a search needs origin, destination, and date, and a schedule can use origin plus train or destination.",
      "The server will query actual railway schedules, fares, and availability after you classify and extract parameters. Never answer with invented train, fare, schedule, or availability data. Keep reply concise; the app adds verified results.",
      "The app can open My Bookings, Contact Us, ticket verification, and the published timetable when requested. Live train location is unavailable.",
      `Current page (${currentPage}): ${pageGuidance}`,
      `Choices currently available on this page: ${JSON.stringify(availableOptions)}. Only describe choices in this list as currently available.`,
      "This service is not the official Bangladesh Railway service. Do not request passwords, OTPs, card numbers, or sensitive payment details.",
      "Return only JSON with reply, journey, intent, and query. Use a short follow-up in reply when required information is missing. For GENERAL_RAILWAY_QUERY, answer normally without claiming unverified railway facts.",
      "Set journey only when the user clearly wants to search for a specific origin and destination. Use station_code values from the supplied list. Include date when the user provides a date or clear relative date such as tomorrow, interpreting relative dates from Bangladesh local date; format it YYYY-MM-DD. Include coach only when explicitly requested and matching one of the allowed values. Otherwise use null for those optional fields.",
      "Journey shape: {\"from\": station_code, \"to\": station_code, \"date\": YYYY-MM-DD or null, \"coach\": allowed coach type or null}. If the request is ambiguous or a station cannot be matched, set journey to null and ask a short follow-up in reply.",
      `Stations: ${JSON.stringify(stations)}`,
      `Allowed coach types: ${JSON.stringify(COACH_TYPES)}`,
      `Today's date in Bangladesh: ${bangladeshToday}.`,
    ].join("\n");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    let response;
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "x-goog-api-key": process.env.GEMINI_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instructions }] },
          contents: conversation.map((item) => ({
            role: item.role === "assistant" ? "model" : "user",
            parts: [{ text: item.content }],
          })),
          generationConfig: {
            responseFormat: {
              text: {
                mimeType: "APPLICATION_JSON",
                schema: {
                  type: "object",
                  properties: {
                    reply: { type: "string" },
                    intent: { type: "string", enum: INTENTS },
                    query: {
                      type: "object",
                      properties: {
                        origin: { type: ["string", "null"] },
                        destination: { type: ["string", "null"] },
                        train_name: { type: ["string", "null"] },
                        date: { type: ["string", "null"] },
                        departure_after: { type: ["string", "null"] },
                        departure_before: { type: ["string", "null"] },
                        arrival_after: { type: ["string", "null"] },
                        arrival_before: { type: ["string", "null"] },
                        max_duration_minutes: { type: ["integer", "null"] },
                        passengers: { type: ["integer", "null"] },
                        coach: { type: ["string", "null"] },
                        max_fare: { type: ["number", "null"] },
                        preference: { type: ["string", "null"], enum: ["cheapest", "fastest", "earliest", "latest", null] },
                        overnight_allowed: { type: ["boolean", "null"] },
                      },
                      required: ["origin", "destination", "train_name", "date", "departure_after", "departure_before", "arrival_after", "arrival_before", "max_duration_minutes", "passengers", "coach", "max_fare", "preference", "overnight_allowed"],
                      propertyOrdering: ["origin", "destination", "train_name", "date", "departure_after", "departure_before", "arrival_after", "arrival_before", "max_duration_minutes", "passengers", "coach", "max_fare", "preference", "overnight_allowed"],
                    },
                    journey: {
                      type: ["object", "null"],
                      properties: {
                        from: { type: "string" },
                        to: { type: "string" },
                        date: { type: ["string", "null"] },
                        coach: { type: ["string", "null"], enum: ["Shuvon Chair", "Snigdha", "AC Chair", null] },
                      },
                      required: ["from", "to", "date", "coach"],
                      propertyOrdering: ["from", "to", "date", "coach"],
                    },
                  },
                  required: ["reply", "journey", "intent", "query"],
                  propertyOrdering: ["reply", "journey", "intent", "query"],
                },
              },
            },
          },
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Gemini assistant request failed:", response.status, payload.error?.status || "unknown error", payload.error?.message || "");
      if (response.status === 503 || payload.error?.status === "UNAVAILABLE") {
        return res.status(503).json({ error: "Gemini is temporarily busy. Please wait a moment and try again." });
      }
      if (response.status === 429 || payload.error?.status === "RESOURCE_EXHAUSTED") {
        return res.status(429).json({ error: "Gemini's request limit or quota was reached. Please try again later." });
      }
      if (response.status === 401 || response.status === 403 || payload.error?.status === "UNAUTHENTICATED" || payload.error?.status === "PERMISSION_DENIED") {
        return res.status(503).json({ error: "The AI assistant API key is invalid or does not have Gemini API access. Check GEMINI_API_KEY in .env and restart the server." });
      }
      return res.status(502).json({ error: "The assistant could not respond right now. Please try again." });
    }

    const output = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
    let result;
    try { result = JSON.parse(output); } catch { result = null; }
    if (typeof result?.reply !== "string") {
      return res.status(502).json({ error: "The assistant returned an incomplete response. Please try again." });
    }

    const query = result.query && typeof result.query === "object" ? result.query : {};
    const latestMessage = conversation[conversation.length - 1].content;
    const asksForLastTrain = /\b(last train|latest train|last service)\b|শেষ\s*ট্রেন|shesh train/i.test(latestMessage);
    if (asksForLastTrain) query.preference = "latest";
    const asksForSchedule = /\b(when does|what time does|what trains? (?:leave|depart|run)|train schedule|timetable|departure time|arrival time)\b|কয়টায়|কয়টায়|সময়\s*সূচি|সময়\s*সূচি|আজ রাতে.*ট্রেন|train koytay? chare|kon train.*(?:chare|ache)/i.test(latestMessage);
    const intent = (asksForLastTrain && !query.date && query.origin && query.destination)
      || (asksForSchedule && query.origin)
      ? "SCHEDULE_QUERY"
      : INTENTS.includes(result.intent) ? result.intent : "GENERAL_RAILWAY_QUERY";
    let reply = result.reply.trim().slice(0, 2500);
    let data = null;
    if (intent !== "GENERAL_RAILWAY_QUERY") {
      const built = await buildAssistantData(intent, query, stations);
      if (built.error) reply = built.error;
      else {
        data = built.data;
        reply = resultReply(intent, data, customerUsesBangla(conversation[conversation.length - 1].content)) || reply;
      }
    }

    let journey = null;
    const suggested = ["TRAIN_SEARCH", "JOURNEY_PLANNING"].includes(intent) ? result.journey : null;
    if (suggested && typeof suggested === "object") {
      const stationCodes = new Set(stations.map((station) => station.station_code));
      const from = String(suggested.from || "").toUpperCase();
      const to = String(suggested.to || "").toUpperCase();
      let date = typeof suggested.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(suggested.date) ? suggested.date : null;
      if (date) {
        const { rows } = await pool.query("SELECT CURRENT_DATE::text AS today, (CURRENT_DATE + 365)::text AS latest");
        if (date < rows[0].today || date > rows[0].latest || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) date = null;
      }
      const coach = COACH_TYPES.includes(suggested.coach) ? suggested.coach : "";
      if (from !== to && stationCodes.has(from) && stationCodes.has(to)) journey = { from, to, date, coach, filters: journeyFilters(query) };
    }

    if (!journey && ["TRAIN_SEARCH", "JOURNEY_PLANNING"].includes(intent)) {
      const from = resolveStationCode(query.origin, stations);
      const to = resolveStationCode(query.destination, stations);
      if (from && to && from !== to) {
        journey = {
          from,
          to,
          date: typeof query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : null,
          coach: COACH_TYPES.includes(query.coach) ? query.coach : "",
          filters: journeyFilters(query),
        };
      }
    }

    res.json({ reply, journey, data });
  } catch (error) {
    const networkFailure = error?.cause?.code === "EACCES"
      || error?.cause?.code === "ENETUNREACH"
      || error?.cause?.code === "ECONNREFUSED"
      || error?.cause?.code === "EAI_AGAIN"
      || error?.message === "fetch failed";
    console.error("Assistant request failed:", error.name === "AbortError" ? "timeout" : networkFailure ? "Gemini network connection failed" : error.message);
    if (error.name === "AbortError") return res.status(503).json({ error: "Gemini took too long to respond. Please try again." });
    if (networkFailure) return res.status(503).json({ error: "The server cannot reach Gemini. Check the server's internet access or firewall, then try again." });
    res.status(502).json({ error: "The assistant could not respond right now. Please try again." });
  }
});

module.exports = router;
