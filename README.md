# BD Railway — ticket booking prototype

A working full-stack prototype: **Express + PostgreSQL** backend, plain **React** frontend
(no build step — Babel runs in the browser). Built directly on the provided ER schema.

## Project layout

```
database/
  schema.sql     DDL — matches the ER diagram exactly, plus one additive user_auth table
  seed.js        populates stations/routes/trains/coaches/seats/trips + a demo user
src/
  db/pool.js             pg connection pool
  config/fares.js        FARES + CLASS_INFO (app-level, since there's no fare table)
  middleware/auth.js      JWT verification
  middleware/errorHandler.js
  routes/
    auth.js       register / login / me
    stations.js
    search.js     the from→to→date→class search
    trips.js      coach + seat listing for a trip
    bookings.js   create hold, pay, list, fetch by PNR
    classes.js
  app.js          express app wiring
  server.js       entrypoint + periodic expiry sweep
public/
  index.html      loads React/Babel from CDN
  app.jsx         the whole frontend (fetches the API above)
```

## 1. Set up PostgreSQL

Create a database and point `DATABASE_URL` at it:

```bash
createdb bd_railway
cp .env.example .env
# edit .env: DATABASE_URL, and set JWT_SECRET to a long random string
```

## 2. Install, migrate, seed

```bash
npm install
npm run migrate   # runs database/schema.sql
npm run seed      # populates reference data + a demo user
```

Demo login after seeding: **rahim@example.com / password123**

## 3. Run it

```bash
npm start          # or: npm run dev  (nodemon, auto-restart)
```

Visit **http://localhost:3000** — Express serves both the API (`/api/*`) and the
static frontend (`public/`) from the same port, so there's no separate frontend
server or CORS setup to worry about.

## API reference

| Method | Path                                     | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/register`                     | –    | `{first_name,last_name,email,password}` |
| POST | `/api/auth/login`                        | –    | `{email,password}` → `{token,user}` |
| GET  | `/api/auth/me`                           | ✓    | returns the decoded token's user |
| GET  | `/api/stations`                          | –    | all stations |
| GET  | `/api/classes`                           | –    | distinct `coach_type`s + fare + description |
| GET  | `/api/search?from&to&date&klass`         | –    | valid trips (route/stop_order aware) + live per-class availability |
| GET  | `/api/trips/:tripId/coaches?klass`       | –    | coaches of a trip's train, optionally filtered by class |
| GET  | `/api/trips/:tripId/coaches/:coachId/seats` | – | seat map with live `taken` flag |
| POST | `/api/bookings`                          | ✓    | `{trip_id,coach_id,from,to,seats:[{seat_id,passenger_name,passenger_age}]}` — creates the pending booking + tickets, starts the 5-minute hold |
| GET  | `/api/bookings`                          | ✓    | the logged-in user's bookings, with `effective_status` |
| GET  | `/api/bookings/:pnr`                     | ✓    | full booking + tickets + payment |
| POST | `/api/bookings/:pnr/pay`                 | ✓    | `{method}` — re-verifies the hold hasn't expired, then confirms |

All fares, seat availability, and booking status are computed server-side from
the database on every request — the frontend never sends a price or an
availability count that the server trusts.

## How the tricky parts are handled

**5-minute hold.** There's no `expires_at` column, so every read computes
`booking_date + 5 minutes` on the fly (`now() - booking_date < interval '5 minutes'`),
and a background sweep (`src/server.js`, every 15s) also flips stale `pending`
rows to `expired` so the stored status stays honest even for bookings nobody
happens to query.

**Concurrency.** Two people can never both book the same seat on the same trip.
`POST /api/bookings` takes a Postgres advisory lock per `(trip_id, seat_id)`
pair inside the transaction before checking availability — the second request
blocks until the first commits or rolls back, then sees the seat is taken and
is rejected. This was tested directly: 5 simultaneous requests for one seat →
exactly 1 succeeds, 4 get "seat no longer available."

**Fares.** The schema has no fare table; `src/config/fares.js` holds a small
`coach_type → price` map, matching the spec's instruction to add a configurable
application-level mapping rather than inventing a database field.

**Auth.** `users` has no password column. Rather than alter that table, a
separate `user_auth(user_id, password_hash)` table was added — additive, 1:1,
and clearly called out in `schema.sql` as the one deliberate departure from the
diagram, exactly as the "optional schema improvement" the original brief flagged.

## What's still prototype-grade

- Payment is simulated (no real gateway) — the checkbox on the payment page
  lets you force a failed attempt to see that path.
- No admin UI for managing trains/coaches/trips — use `psql` or extend
  `database/seed.js`.
- No rate limiting / refresh tokens — the JWT is a 7-day bearer token in
  `localStorage`, fine for a demo, not for production.
