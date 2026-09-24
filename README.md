# BD Railway — ticket booking prototype

A working full-stack prototype: **Express + PostgreSQL** backend, plain **React** frontend
(no build step — Babel runs in the browser). Built directly on the provided ER schema.

## Project layout

```
database/
  schema.sql     DDL — matches the ER diagram exactly, plus one additive user_auth table
  seed.js        populates stations/routes/trains/coaches/seats/trips + a demo user
migrations/    additive migrations for existing databases
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

For an existing database, apply train stop times with `npm run migrate:train-schedule`
followed by `npm run migrate:seed-train-times`. New databases get the schedule table
from `database/schema.sql`; `database/seed.js` fills each seeded train's stop times.
To add the expanded station network and daily services to an existing database, run
`npm run migrate:daily-services`. Search then creates a date-specific trip from each
complete timetable when requested, for dates up to one year ahead.
For per-ticket cancellation/refund records and train reviews, apply
`npm run migrate:reviews-refunds`.
Contact form storage can be added to an existing database with
`npm run migrate:contact-messages`.

## 1. Clone and install

On a new device, install [Node.js](https://nodejs.org/) and PostgreSQL first.
Then clone the repository and install its dependencies:

```bash
git clone <repository-url>
cd railway_management
npm install
```

## 2. Configure PostgreSQL

Create a database and point `DATABASE_URL` at it:

```bash
createdb bd_railway
cp .env.example .env
# edit .env: DATABASE_URL, and set JWT_SECRET to a long random string
```

For example, you can generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Your `.env` is local-only and is ignored by Git. Never commit it or share it;
each developer must create their own from `.env.example`.

## 3. Create the schema and demo data

```bash
npm run migrate   # runs database/schema.sql
npm run seed      # populates reference data + demo customer/admin accounts
```

Demo customer login after seeding: **rahim@example.com / password123**

Demo admin login after seeding: **admin@example.com / admin123**. Public registration always creates a customer account. Admins can view all users/bookings, grant or revoke other users' admin roles, and cancel pending or confirmed bookings.

For an existing database created before these changes, run these one-time migrations instead of recreating it:

```bash
npm run migrate:roles
npm run migrate:auth-sessions
npm run migrate:constraints
npm run migrate:password-reset
```

## Gmail password reset

Add these values to the server's `.env` to enable one-time password reset codes:

```dotenv
GMAIL_USER=your-gmail-address@gmail.com
GMAIL_APP_PASSWORD=your-google-app-password
```

Use a Google App Password for the Gmail account (with 2-Step Verification enabled), not the account's normal password. Restart the server after saving the values. Codes are valid for 10 minutes, limited to five attempts, and can be requested once per minute. Existing sessions are signed out after a successful reset.

## Customer assistant

The floating RailX assistant answers support questions in English or Bangla and can fill in a requested journey in the train search form. It uses the Gemini API from the Express server with the Gemini 3.5 Flash-Lite model; the API key is never sent to the browser. Add `GEMINI_API_KEY` to `.env` and restart the server to enable AI replies. Without a key, the assistant displays a setup message. Journey suggestions only populate the search form; customers still review results and complete bookings through the normal flow.

## 4. Run it

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
| POST | `/api/auth/login`                        | –    | `{email,password}` → HTTP-only session cookie + `{user}` |
| POST | `/api/auth/password-reset/request`         | –    | `{email}` → emails a short-lived Gmail verification code |
| POST | `/api/auth/password-reset/confirm`         | –    | `{email,otp,password}` → verifies code and changes password |
| GET  | `/api/auth/me`                           | ✓    | returns the decoded token's user |
| POST | `/api/auth/logout`                       | ✓    | revokes the server-side session and clears its cookie |
| GET  | `/api/stations`                          | –    | all stations |
| GET  | `/api/classes`                           | –    | distinct `coach_type`s + fare + description |
| GET  | `/api/search?from&to&date&klass`         | –    | valid trips (route/stop_order aware) + live per-class availability |
| GET  | `/api/trips/:tripId/coaches?klass`       | –    | coaches of a trip's train, optionally filtered by class |
| GET  | `/api/trips/:tripId/coaches/:coachId/seats` | – | seat map with live `taken` flag |
| POST | `/api/bookings`                          | ✓    | `{trip_id,coach_id,from,to,seats:[{seat_id,passenger_name,passenger_age}]}` — creates the pending booking + tickets, starts the 5-minute hold |
| GET  | `/api/bookings`                          | ✓    | the logged-in user's bookings, with `effective_status` |
| GET  | `/api/bookings/:pnr`                     | ✓    | full booking + tickets + payment |
| POST | `/api/bookings/:pnr/pay`                 | ✓    | `{method}` — re-verifies the hold hasn't expired, then confirms |
| DELETE | `/api/bookings/:pnr`                   | ✓    | cancels the caller's pending hold and releases its seats |

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
Login creates an HTTP-only, same-site session cookie. Its JWT session ID is also
persisted in `auth_session`, so logout revokes the session and an old copied
cookie/token cannot be reused.

## What's still prototype-grade

- Payment is simulated (no real gateway) — the checkbox on the payment page
  lets you force a failed attempt to see that path.
- The admin dashboard currently provides system counts only; management of
  trains/coaches/trips still uses `psql` or `database/seed.js`.
- No rate limiting / refresh-token rotation; the HTTP-only session cookie lasts
  seven days, suitable for this course demonstration but not a complete
  production security programme.
