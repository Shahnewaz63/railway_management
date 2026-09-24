const router = require("express").Router();
const pool = require("../db/pool");

const MODEL = "gemini-3.5-flash-lite";
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 12;
const requestWindows = new Map();
const COACH_TYPES = ["Shuvon Chair", "Snigdha", "AC Chair"];

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
    const dateParts = new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date()).reduce((parts, item) => ({ ...parts, [item.type]: item.value }), {});
    const bangladeshToday = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
    const instructions = [
      "You are RailX BD's friendly customer support assistant for a Bangladesh train booking demo.",
      "Reply in the same language as the customer. Support Bangla in বাংলা script and English; be concise and welcoming.",
      "Help explain how to search trains, choose a class/coach/seat, enter passenger details, pay, verify tickets, and find bookings.",
      "Never claim a train runs, a seat is available, a fare is current, or a booking was made. The app search is the source of truth for schedules and live availability.",
      "This is a prototype, not the official Bangladesh Railway service. Do not request passwords, OTPs, card numbers, or sensitive payment details.",
      "Return only a JSON object with exactly these keys: reply (string) and journey (object or null).",
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
                  required: ["reply", "journey"],
                  propertyOrdering: ["reply", "journey"],
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
      return res.status(502).json({ error: "The assistant could not respond right now. Please try again." });
    }

    const output = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
    let result;
    try { result = JSON.parse(output); } catch { result = null; }
    if (typeof result?.reply !== "string") {
      return res.status(502).json({ error: "The assistant returned an incomplete response. Please try again." });
    }

    let journey = null;
    const suggested = result.journey;
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
      if (from !== to && stationCodes.has(from) && stationCodes.has(to)) journey = { from, to, date, coach };
    }

    res.json({ reply: result.reply.slice(0, 2500), journey });
  } catch (error) {
    console.error("Assistant request failed:", error.name === "AbortError" ? "timeout" : error.message);
    if (error.name === "AbortError") return res.status(503).json({ error: "Gemini took too long to respond. Please try again." });
    res.status(502).json({ error: "The assistant could not respond right now. Please try again." });
  }
});

module.exports = router;
