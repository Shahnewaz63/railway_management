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
const errorHandler = require("./middleware/errorHandler");

const app = express();
// The frontend is served by this same Express application. Avoiding a wide
// open CORS policy prevents other origins from invoking cookie-authenticated
// endpoints in a browser.
app.use(express.json({ limit: "100kb" }));

app.use("/api/auth", authRoutes);
app.use("/api/stations", stationRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/trips", tripRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/classes", classRoutes);
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
