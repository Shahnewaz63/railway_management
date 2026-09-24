const express = require("express");
const path = require("path");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const stationRoutes = require("./routes/stations");
const searchRoutes = require("./routes/search");
const tripRoutes = require("./routes/trips");
const bookingRoutes = require("./routes/bookings");
const classRoutes = require("./routes/classes");
const adminRoutes = require("./routes/admin");
const contactRoutes = require("./routes/contact");
const errorHandler = require("./middleware/errorHandler");
const { hideApiFromDirectBrowsing } = require("./middleware/apiVisibility");

const app = express();
// The frontend is served by this same Express application. Avoiding a wide
// open CORS policy prevents other origins from invoking cookie-authenticated
// endpoints in a browser.
app.use(express.json({ limit: "100kb" }));

// Applies to every /api/* route below: makes the API invisible to someone
// typing its URL directly into the browser (or following a link to it)
// unless they're a signed-in admin. See middleware/apiVisibility.js for what
// this does and does not protect against — the real access control is
// unchanged and lives in requireAuth/requireAdmin per route.
app.use("/api", hideApiFromDirectBrowsing);

app.use("/api/auth", authRoutes);
app.use("/api/stations", stationRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/trips", tripRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/classes", classRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/admin", adminRoutes);

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found." });
  next();
});

const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));
app.get("*", (req, res) => res.sendFile(path.join(publicDir, "index.html")));

app.use(errorHandler);

module.exports = app;
