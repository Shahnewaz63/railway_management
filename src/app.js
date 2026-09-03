const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const stationRoutes = require("./routes/stations");
const searchRoutes = require("./routes/search");
const tripRoutes = require("./routes/trips");
const bookingRoutes = require("./routes/bookings");
const classRoutes = require("./routes/classes");
const errorHandler = require("./middleware/errorHandler");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/stations", stationRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/trips", tripRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/classes", classRoutes);

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found." });
  next();
});

const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));
app.get("*", (req, res) => res.sendFile(path.join(publicDir, "index.html")));

app.use(errorHandler);

module.exports = app;
