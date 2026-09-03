const { useState, useEffect, useMemo } = React;

/* ============================== API client ============================== */

const TOKEN_KEY = "bdr_token";

async function api(path, { method = "GET", body, auth = true } = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch("/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth && token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data.error || "Something went wrong. Please try again.");
    err.status = res.status;
    throw err;
  }
  return data;
}

const HOLD_MS = 5 * 60 * 1000;

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}
function fmtMMSS(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

/* ============================== Theme ============================== */

function useTheme() {
  const [theme, setTheme] = useState(localStorage.getItem("bdr_theme") || "light");
  useEffect(() => localStorage.setItem("bdr_theme", theme), [theme]);
  const dark = theme === "dark";
  const t = {
    dark,
    pageBg: dark ? "bg-slate-950" : "bg-slate-50",
    text: dark ? "text-slate-100" : "text-slate-900",
    subtext: dark ? "text-slate-400" : "text-slate-500",
    navBg: dark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200",
    cardBg: dark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200",
    cardAltBg: dark ? "bg-slate-800/60 border-slate-700" : "bg-slate-100 border-slate-200",
    inputBg: dark ? "bg-slate-800 border-slate-700 text-slate-100" : "bg-white border-slate-300 text-slate-900",
    hero: dark ? "bg-blue-950" : "bg-blue-900",
    primary: "bg-blue-800 hover:bg-blue-700 text-white",
    primaryOutline: dark ? "border border-slate-700 hover:bg-slate-800 text-slate-100" : "border border-slate-300 hover:bg-slate-100 text-slate-900",
    divider: dark ? "border-slate-800" : "border-slate-200",
  };
  return { theme, setTheme, t };
}

/* ============================== Atoms ============================== */

function Badge({ children, tone = "default", t }) {
  const tones = {
    default: t.dark ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600",
    success: "bg-green-100 text-green-700",
    warn: "bg-orange-100 text-orange-700",
    danger: "bg-red-100 text-red-700",
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
function PrimaryButton({ children, onClick, disabled, className = "", t }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`px-5 py-2.5 rounded-md font-medium text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${t.primary} ${className}`}>
      {children}
    </button>
  );
}
function OutlineButton({ children, onClick, className = "", t }) {
  return (
    <button onClick={onClick} className={`px-5 py-2.5 rounded-md font-medium text-sm transition-colors ${t.primaryOutline} ${className}`}>
      {children}
    </button>
  );
}
function Field({ label, children, t }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className={`font-medium ${t.subtext}`}>{label}</span>
      {children}
    </label>
  );
}
function ErrorBanner({ message }) {
  if (!message) return null;
  return <p className="mt-3 text-sm text-red-500 flex items-center gap-1.5">&#9888; {message}</p>;
}
function InfoRow({ t, label, value }) {
  return (
    <div>
      <p className={`text-xs ${t.subtext}`}>{label}</p>
      <p className={`font-medium ${t.text}`}>{value}</p>
    </div>
  );
}
function BackBar({ t, onBack, label }) {
  return (
    <button onClick={onBack} className={`mb-4 text-sm flex items-center gap-1.5 ${t.subtext} hover:text-blue-600`}>
      &larr; {label}
    </button>
  );
}
function StationSelect({ value, onChange, t, stations, excludeCode }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`w-full px-3 py-2.5 rounded-md border text-sm ${t.inputBg}`}>
      <option value="">Select station</option>
      {stations.filter((s) => s.station_code !== excludeCode).map((s) => (
        <option key={s.station_code} value={s.station_code}>{s.station_name} — {s.city}</option>
      ))}
    </select>
  );
}
function JourneySummary({ t, trainName, fromCity, toCity, date, klass, coachNumber, fare }) {
  return (
    <div className={`rounded-xl border p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm ${t.cardAltBg}`}>
      <div><p className={t.subtext}>Train</p><p className={`font-medium ${t.text}`}>{trainName}</p></div>
      <div><p className={t.subtext}>Route</p><p className={`font-medium ${t.text}`}>{fromCity} → {toCity}</p></div>
      <div><p className={t.subtext}>Date</p><p className={`font-medium ${t.text}`}>{fmtDate(date)}</p></div>
      <div><p className={t.subtext}>Class</p><p className={`font-medium ${t.text}`}>{klass}{coachNumber != null ? ` · Coach ${coachNumber}` : ""}</p></div>
      {fare != null && <div><p className={t.subtext}>Fare / seat</p><p className={`font-medium ${t.text}`}>৳{fare}</p></div>}
    </div>
  );
}

/* ============================== Nav ============================== */

function NavBar({ page, go, t, setTheme, currentUser, logout }) {
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const links = [
    { key: "home", label: "Home" },
    { key: "classinfo", label: "Class Info" },
    { key: "about", label: "About Us" },
    { key: "contact", label: "Contact" },
  ];
  return (
    <header className={`sticky top-0 z-30 border-b ${t.navBg}`}>
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <button className="flex items-center gap-2 font-semibold" onClick={() => go("home")}>
          <div className="w-8 h-8 rounded-md bg-blue-800 flex items-center justify-center text-white text-sm">&#128646;</div>
          <span className={t.text}>BD Railway</span>
        </button>

        <nav className="hidden md:flex items-center gap-6">
          {links.map((l) => (
            <button key={l.key} onClick={() => go(l.key)} className={`text-sm font-medium ${page === l.key ? "text-blue-600" : t.subtext} hover:text-blue-600`}>
              {l.label}
            </button>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <button onClick={() => setTheme((th) => (th === "light" ? "dark" : "light"))} className={`p-2 rounded-md ${t.primaryOutline}`}>
            {t.dark ? "\u2600" : "\u263D"}
          </button>
          {currentUser ? (
            <div className="relative">
              <button onClick={() => setMenuOpen((o) => !o)} className={`flex items-center gap-2 px-3 py-2 rounded-md ${t.primaryOutline}`}>
                <span className="text-sm">{currentUser.first_name}</span> &#9662;
              </button>
              {menuOpen && (
                <div className={`absolute right-0 mt-2 w-44 rounded-md border shadow-lg py-1 ${t.cardBg}`} onMouseLeave={() => setMenuOpen(false)}>
                  <button onClick={() => { go("mybookings"); setMenuOpen(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-600/10 ${t.text}`}>My Bookings</button>
                  <button onClick={() => { go("account"); setMenuOpen(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-600/10 ${t.text}`}>Profile</button>
                  <button onClick={() => { logout(); setMenuOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-red-500/10">Logout</button>
                </div>
              )}
            </div>
          ) : (
            <OutlineButton t={t} onClick={() => go("login")}>Login</OutlineButton>
          )}
        </div>

        <button className="md:hidden p-2" onClick={() => setOpen((o) => !o)}>{open ? "\u2715" : "\u2630"}</button>
      </div>

      {open && (
        <div className={`md:hidden border-t ${t.divider} px-4 py-3 flex flex-col gap-3`}>
          {links.map((l) => (
            <button key={l.key} onClick={() => { go(l.key); setOpen(false); }} className={`text-left text-sm font-medium ${t.text}`}>{l.label}</button>
          ))}
          <div className={`h-px border-t ${t.divider}`} />
          {currentUser ? (
            <>
              <button onClick={() => { go("mybookings"); setOpen(false); }} className={`text-left text-sm font-medium ${t.text}`}>My Bookings</button>
              <button onClick={() => { logout(); setOpen(false); }} className="text-left text-sm font-medium text-red-500">Logout</button>
            </>
          ) : (
            <button onClick={() => { go("login"); setOpen(false); }} className="text-left text-sm font-medium text-blue-600">Login</button>
          )}
          <button onClick={() => setTheme((th) => (th === "light" ? "dark" : "light"))} className={`self-start px-3 py-1.5 rounded-md text-sm ${t.primaryOutline}`}>
            {t.dark ? "Light mode" : "Dark mode"}
          </button>
        </div>
      )}
    </header>
  );
}

/* ============================== Search card ============================== */

function SearchCard({ t, search, setSearch, onSubmit, error, stations, classTypes }) {
  const swap = () => setSearch((s) => ({ ...s, from: s.to, to: s.from }));
  return (
    <div className={`rounded-xl border shadow-sm p-5 md:p-6 ${t.cardBg}`}>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-end">
        <Field label="From" t={t}><StationSelect value={search.from} onChange={(v) => setSearch((s) => ({ ...s, from: v }))} t={t} stations={stations} excludeCode={search.to} /></Field>
        <button onClick={swap} className={`hidden md:flex items-center justify-center w-10 h-10 rounded-full mb-0.5 self-end ${t.primaryOutline}`}>&#8646;</button>
        <Field label="To" t={t}><StationSelect value={search.to} onChange={(v) => setSearch((s) => ({ ...s, to: v }))} t={t} stations={stations} excludeCode={search.from} /></Field>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
        <Field label="Journey date" t={t}>
          <input type="date" min={todayISO()} value={search.date} onChange={(e) => setSearch((s) => ({ ...s, date: e.target.value }))} className={`w-full px-3 py-2.5 rounded-md border text-sm ${t.inputBg}`} />
        </Field>
        <Field label="Class" t={t}>
          <select value={search.klass} onChange={(e) => setSearch((s) => ({ ...s, klass: e.target.value }))} className={`w-full px-3 py-2.5 rounded-md border text-sm ${t.inputBg}`}>
            <option value="">All Classes</option>
            {classTypes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <div className="flex items-end">
          <PrimaryButton t={t} onClick={onSubmit} className="w-full">&#128269; Search Trains</PrimaryButton>
        </div>
      </div>
      <ErrorBanner message={error} />
    </div>
  );
}

/* ============================== Pages ============================== */

function HomePage({ t, search, setSearch, doSearch, searchError, stations, classTypes }) {
  return (
    <div>
      <div className={`${t.hero} text-white`}>
        <div className="max-w-6xl mx-auto px-4 pt-16 pb-28 md:pt-24 md:pb-36 text-center">
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight">Travel across Bangladesh by train</h1>
          <p className="mt-4 text-blue-100 text-base md:text-lg max-w-xl mx-auto">Search trains, check seat availability and book your journey easily.</p>
        </div>
      </div>
      <div className="max-w-4xl mx-auto px-4 -mt-16 md:-mt-20 pb-16">
        <SearchCard t={t} search={search} setSearch={setSearch} onSubmit={doSearch} error={searchError} stations={stations} classTypes={classTypes} />
      </div>
    </div>
  );
}

function LoginPage({ t, pendingSearch, onLogin, stations }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "rahim@example.com", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const stationCity = (code) => stations.find((s) => s.station_code === code)?.city || code;

  const submit = async () => {
    setError("");
    setLoading(true);
    try {
      const data = mode === "login"
        ? await api("/auth/login", { method: "POST", body: { email: form.email, password: form.password }, auth: false })
        : await api("/auth/register", { method: "POST", body: form, auth: false });
      onLogin(data.token, data.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-14">
      <h1 className={`text-2xl font-bold ${t.text}`}>{mode === "login" ? "Login" : "Create Account"}</h1>

      {pendingSearch && (
        <div className={`mt-4 rounded-md border p-3 text-sm ${t.cardAltBg} ${t.text}`}>
          Please log in to continue with train search and booking.
          <div className={`mt-1 ${t.subtext}`}>
            {stationCity(pendingSearch.from)} → {stationCity(pendingSearch.to)}, {fmtDate(pendingSearch.date)}
            {pendingSearch.klass ? `, ${pendingSearch.klass}` : ""}
          </div>
        </div>
      )}

      <div className={`mt-6 rounded-xl border p-5 space-y-4 ${t.cardBg}`}>
        {mode === "register" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="First Name" t={t}><input value={form.first_name} onChange={(e) => upd("first_name", e.target.value)} className={`w-full px-3 py-2.5 rounded-md border text-sm ${t.inputBg}`} /></Field>
            <Field label="Last Name" t={t}><input value={form.last_name} onChange={(e) => upd("last_name", e.target.value)} className={`w-full px-3 py-2.5 rounded-md border text-sm ${t.inputBg}`} /></Field>
          </div>
        )}
        <Field label="Email" t={t}><input value={form.email} onChange={(e) => upd("email", e.target.value)} className={`w-full px-3 py-2.5 rounded-md border text-sm ${t.inputBg}`} /></Field>
        <Field label="Password" t={t}><input type="password" value={form.password} onChange={(e) => upd("password", e.target.value)} className={`w-full px-3 py-2.5 rounded-md border text-sm ${t.inputBg}`} /></Field>
        <ErrorBanner message={error} />
        <PrimaryButton t={t} onClick={submit} disabled={loading} className="w-full">
          {loading ? "Please wait…" : mode === "login" ? "Login" : "Create Account"}
        </PrimaryButton>
        <div className="flex justify-between text-sm">
          <button onClick={() => setMode(mode === "login" ? "register" : "login")} className="text-blue-600 hover:underline">
            {mode === "login" ? "Create Account" : "Back to Login"}
          </button>
          {mode === "login" && <button className="text-blue-600 hover:underline">Forgot Password?</button>}
        </div>
        {mode === "login" && (
          <p className={`text-xs ${t.subtext} pt-2 border-t ${t.divider}`}>Demo login — email: <b>rahim@example.com</b>, password: <b>password123</b></p>
        )}
      </div>
    </div>
  );
}

function ResultsPage({ t, search, go, stations }) {
  const [trips, setTrips] = useState(null);
  const [error, setError] = useState("");
  const from = stations.find((s) => s.station_code === search.from);
  const to = stations.find((s) => s.station_code === search.to);

  useEffect(() => {
    let cancelled = false;
    setTrips(null);
    api(`/search?from=${search.from}&to=${search.to}&date=${search.date}${search.klass ? `&klass=${encodeURIComponent(search.klass)}` : ""}`)
      .then((data) => { if (!cancelled) setTrips(data); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [search.from, search.to, search.date, search.klass]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className={`text-xl font-bold ${t.text}`}>{from?.city} → {to?.city}</h1>
          <p className={`text-sm ${t.subtext}`}>{fmtDate(search.date)}{search.klass ? ` · ${search.klass}` : ""}</p>
        </div>
        <OutlineButton t={t} onClick={() => go("home")}>&larr; Modify Search</OutlineButton>
      </div>

      <ErrorBanner message={error} />
      {trips === null && !error && <p className={t.subtext}>Loading trains…</p>}

      {trips && trips.length === 0 && (
        <div className={`rounded-xl border p-8 text-center ${t.cardBg}`}>
          <p className={t.text}>No trains are available for this journey.</p>
        </div>
      )}

      <div className="space-y-4">
        {trips && trips.map((trip) => (
          <div key={trip.trip_id} className={`rounded-xl border p-5 ${t.cardBg}`}>
            <h2 className={`font-semibold mb-3 ${t.text}`}>&#128646; {trip.train_name}</h2>
            <div className="grid gap-2">
              {trip.classes.map((c) => (
                <div key={c.coach_type} className={`flex items-center justify-between rounded-md border px-4 py-3 ${t.cardAltBg}`}>
                  <div>
                    <p className={`font-medium text-sm ${t.text}`}>{c.coach_type}</p>
                    <p className={`text-xs ${c.available > 0 ? t.subtext : "text-red-500"}`}>{c.available > 0 ? `Available: ${c.available}` : "Sold Out"}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`text-sm font-semibold ${t.text}`}>৳{c.fare}</span>
                    <PrimaryButton t={t} disabled={c.available === 0} onClick={() => go("coach", { tripId: trip.trip_id, klass: c.coach_type, fare: c.fare })}>Book Now</PrimaryButton>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CoachPage({ t, go, ctx }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api(`/trips/${ctx.tripId}/coaches?klass=${encodeURIComponent(ctx.klass)}`).then(setData).catch((e) => setError(e.message));
  }, [ctx.tripId, ctx.klass]);

  if (error) return <div className="max-w-3xl mx-auto px-4 py-8"><ErrorBanner message={error} /></div>;
  if (!data) return <div className="max-w-3xl mx-auto px-4 py-8"><p className={t.subtext}>Loading…</p></div>;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <BackBar t={t} onBack={() => go("results")} label="Back to results" />
      <JourneySummary t={t} trainName={data.trip.train_name} fromCity={ctx.search.fromCity} toCity={ctx.search.toCity} date={data.trip.departure_date} klass={ctx.klass} />
      <h2 className={`mt-6 mb-3 font-semibold ${t.text}`}>Select Coach</h2>
      <div className="flex flex-wrap gap-3">
        {data.coaches.map((c) => (
          <button key={c.coach_id} onClick={() => go("seats", { coach: c, trainName: data.trip.train_name, date: data.trip.departure_date })} className={`px-6 py-4 rounded-lg border font-semibold ${t.cardBg} ${t.text} hover:border-blue-600`}>
            Coach {c.coach_number}
          </button>
        ))}
        {data.coaches.length === 0 && <p className={t.subtext}>No coaches of this class on this train.</p>}
      </div>
    </div>
  );
}

function SeatsPage({ t, go, ctx }) {
  const [seats, setSeats] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState([]);

  useEffect(() => {
    api(`/trips/${ctx.tripId}/coaches/${ctx.coach.coach_id}/seats`).then((d) => setSeats(d.seats)).catch((e) => setError(e.message));
  }, [ctx.tripId, ctx.coach.coach_id]);

  if (error) return <div className="max-w-3xl mx-auto px-4 py-8"><ErrorBanner message={error} /></div>;
  if (!seats) return <div className="max-w-3xl mx-auto px-4 py-8"><p className={t.subtext}>Loading seats…</p></div>;

  const toggle = (seat) => {
    if (seat.taken) return;
    setSelected((sel) => (sel.includes(seat.seat_id) ? sel.filter((id) => id !== seat.seat_id) : [...sel, seat.seat_id]));
  };
  const rows = [];
  for (let i = 0; i < seats.length; i += 4) rows.push(seats.slice(i, i + 4));

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <BackBar t={t} onBack={() => go("coach")} label="Back to coach selection" />
      <JourneySummary t={t} trainName={ctx.trainName} fromCity={ctx.search.fromCity} toCity={ctx.search.toCity} date={ctx.date} klass={ctx.klass} coachNumber={ctx.coach.coach_number} fare={ctx.fare} />
      <h2 className={`mt-6 mb-3 font-semibold ${t.text}`}>Select Seat(s) — Coach {ctx.coach.coach_number}</h2>
      <div className="flex gap-4 text-xs mb-4">
        <span className={`flex items-center gap-1.5 ${t.subtext}`}><span className="w-3 h-3 rounded-sm bg-slate-300 inline-block" /> Available</span>
        <span className={`flex items-center gap-1.5 ${t.subtext}`}><span className="w-3 h-3 rounded-sm bg-blue-600 inline-block" /> Selected</span>
        <span className={`flex items-center gap-1.5 ${t.subtext}`}><span className="w-3 h-3 rounded-sm bg-orange-400 inline-block" /> Held / Sold</span>
      </div>
      <div className={`rounded-xl border p-4 space-y-2 ${t.cardBg}`}>
        {rows.map((row, i) => (
          <div key={i} className="flex gap-2 justify-center">
            {row.map((seat, idx) => {
              const isSel = selected.includes(seat.seat_id);
              const cls = seat.taken ? "bg-orange-400 text-white cursor-not-allowed opacity-70"
                : isSel ? "bg-blue-600 text-white"
                : `${t.cardAltBg} ${t.text} hover:border-blue-600`;
              return (
                <React.Fragment key={seat.seat_id}>
                  <button disabled={seat.taken} onClick={() => toggle(seat)} className={`w-11 h-11 rounded-md border text-xs font-semibold flex items-center justify-center ${cls}`}>{seat.seat_number}</button>
                  {idx === 1 && <div className="w-4" />}
                </React.Fragment>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-5">
        <p className={`text-sm ${t.subtext}`}>{selected.length} seat(s) selected</p>
        <PrimaryButton t={t} disabled={selected.length === 0} onClick={() => go("passenger", { seats: seats.filter((s) => selected.includes(s.seat_id)) })}>Continue</PrimaryButton>
      </div>
    </div>
  );
}

function PassengerPage({ t, go, ctx, currentUser }) {
  const [passengers, setPassengers] = useState(ctx.seats.map(() => ({ name: "", age: "" })));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const update = (i, key, val) => setPassengers((p) => p.map((row, idx) => (idx === i ? { ...row, [key]: val } : row)));

  const submit = async () => {
    if (passengers.some((p) => !p.name.trim() || !p.age || Number(p.age) <= 0)) {
      setError("Please enter a valid name and age for every passenger.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const body = {
        trip_id: ctx.tripId,
        coach_id: ctx.coach.coach_id,
        from: ctx.search.from,
        to: ctx.search.to,
        seats: ctx.seats.map((s, i) => ({ seat_id: s.seat_id, passenger_name: passengers[i].name.trim(), passenger_age: Number(passengers[i].age) })),
      };
      const result = await api("/bookings", { method: "POST", body });
      go("payment", { booking: result });
    } catch (e) {
      if (e.status === 409) { alert(e.message); go("seats"); return; }
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <BackBar t={t} onBack={() => go("seats")} label="Back to seat selection" />
      <JourneySummary t={t} trainName={ctx.trainName} fromCity={ctx.search.fromCity} toCity={ctx.search.toCity} date={ctx.date} klass={ctx.klass} coachNumber={ctx.coach.coach_number} fare={ctx.fare} />
      <h2 className={`mt-6 mb-3 font-semibold ${t.text}`}>Passenger Information</h2>
      <div className="space-y-4">
        {ctx.seats.map((seat, i) => (
          <div key={seat.seat_id} className={`rounded-xl border p-4 ${t.cardBg}`}>
            <p className={`text-xs mb-3 ${t.subtext}`}>Seat {seat.seat_number} ({seat.seat_type})</p>
            <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3">
              <Field label="Passenger Name" t={t}><input value={passengers[i].name} onChange={(e) => update(i, "name", e.target.value)} className={`w-full px-3 py-2.5 rounded-md border text-sm ${t.inputBg}`} /></Field>
              <Field label="Age" t={t}><input type="number" min="0" value={passengers[i].age} onChange={(e) => update(i, "age", e.target.value)} className={`w-full px-3 py-2.5 rounded-md border text-sm ${t.inputBg}`} /></Field>
            </div>
          </div>
        ))}
      </div>
      <ErrorBanner message={error} />
      <div className="flex justify-end mt-5">
        <PrimaryButton t={t} onClick={submit} disabled={loading}>{loading ? "Reserving seat…" : "Continue to Payment"}</PrimaryButton>
      </div>
    </div>
  );
}

function PaymentPage({ t, go, ctx, stations }) {
  const [now, setNow] = useState(Date.now());
  const [method, setMethod] = useState("bKash");
  const [failNext, setFailNext] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const booking = ctx.booking.booking;
  const tickets = ctx.booking.tickets;
  const first = tickets[0];
  const bookingDate = new Date(booking.booking_date).getTime();
  const cityOf = (code) => stations.find((s) => s.station_code === code)?.city || code;
  const fromCity = cityOf(booking.starts_at_station);
  const toCity = cityOf(booking.ends_at_station);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = HOLD_MS - (now - bookingDate);
  const active = booking.booking_status === "pending" && remaining > 0;

  if (!active) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <h1 className={`text-xl font-bold ${t.text}`}>Your temporary seat reservation has expired.</h1>
        <div className="flex gap-3 justify-center mt-6">
          <OutlineButton t={t} onClick={() => go("results")}>Search Again</OutlineButton>
          <PrimaryButton t={t} onClick={() => go("home")}>Return Home</PrimaryButton>
        </div>
      </div>
    );
  }

  const pay = async () => {
    if (failNext) { setError("Payment could not be completed. Please try again."); return; }
    setError("");
    setLoading(true);
    try {
      const result = await api(`/bookings/${booking.pnr_number}/pay`, { method: "POST", body: { method } });
      go("ticket", { booking: result });
    } catch (e) {
      // A 410 here means the clock ran out right as payment was submitted;
      // the countdown above will flip to the "expired" view on its own,
      // this message just explains what happened in the meantime.
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <BackBar t={t} onBack={() => go(ctx.fromMyBookings ? "mybookings" : "passenger")} label={ctx.fromMyBookings ? "Back to My Bookings" : "Back"} />
      <JourneySummary t={t} trainName={first.train_name} fromCity={fromCity} toCity={toCity} date={first.departure_date} klass={first.coach_type} coachNumber={first.coach_number} />

      <div className={`mt-4 rounded-md px-4 py-2.5 flex items-center justify-between text-sm ${t.cardAltBg}`}>
        <span className="flex items-center gap-1.5 font-medium text-orange-500">&#9201; Seat held for</span>
        <span className="font-mono font-semibold text-orange-500">{fmtMMSS(remaining)}</span>
      </div>

      <div className={`mt-4 rounded-xl border p-5 ${t.cardBg}`}>
        <h3 className={`font-semibold mb-3 ${t.text}`}>Booking Summary</h3>
        <div className="text-sm space-y-1.5">
          {tickets.map((tk) => (
            <div key={tk.ticket_id} className="flex justify-between">
              <span className={t.subtext}>Passenger — Seat {tk.seat_number}</span>
              <span className={t.text}>{tk.passenger_name}, {tk.passenger_age}y</span>
            </div>
          ))}
        </div>
        <div className={`flex justify-between mt-3 pt-3 border-t font-semibold ${t.divider} ${t.text}`}>
          <span>Total</span><span>৳{booking.fare}</span>
        </div>
      </div>

      <div className={`mt-4 rounded-xl border p-5 ${t.cardBg}`}>
        <h3 className={`font-semibold mb-3 ${t.text}`}>Payment Method</h3>
        <div className="flex gap-3 flex-wrap">
          {["bKash", "Nagad", "Card"].map((m) => (
            <button key={m} onClick={() => setMethod(m)} className={`px-4 py-2 rounded-md border text-sm font-medium ${method === m ? "border-blue-600 text-blue-600" : `${t.cardAltBg} ${t.text}`}`}>{m}</button>
          ))}
        </div>
        <label className={`flex items-center gap-2 mt-4 text-xs ${t.subtext}`}>
          <input type="checkbox" checked={failNext} onChange={(e) => setFailNext(e.target.checked)} />
          Simulate a failed payment (for testing)
        </label>
        <ErrorBanner message={error} />
        <PrimaryButton t={t} onClick={pay} disabled={loading} className="w-full mt-4">{loading ? "Processing…" : `Pay ৳${booking.fare}`}</PrimaryButton>
      </div>
    </div>
  );
}

function TicketPage({ t, go, ctx, stations }) {
  const { booking, tickets, payment } = ctx.booking;
  const first = tickets[0];
  const cityOf = (code) => stations.find((s) => s.station_code === code)?.city || code;
  const fromCity = cityOf(booking.starts_at_station);
  const toCity = cityOf(booking.ends_at_station);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(booking.pnr_number)}`;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="text-center mb-6">
        <p className="text-3xl">&#9989;</p>
        <h1 className={`text-2xl font-bold ${t.text}`}>Booking Confirmed</h1>
      </div>
      <div className={`rounded-xl border p-6 ${t.cardBg}`}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <p className={`text-xs ${t.subtext}`}>PNR Number</p>
            <p className={`text-lg font-bold tracking-wide ${t.text}`}>{booking.pnr_number}</p>
          </div>
          <img src={qrUrl} alt="Ticket QR code" className="w-20 h-20 rounded" />
        </div>
        <div className={`grid grid-cols-2 gap-y-3 gap-x-4 text-sm border-t pt-4 ${t.divider}`}>
          <InfoRow t={t} label="Train" value={first.train_name} />
          <InfoRow t={t} label="Route" value={`${fromCity} → ${toCity}`} />
          <InfoRow t={t} label="Journey Date" value={fmtDate(first.departure_date)} />
          <InfoRow t={t} label="Class" value={first.coach_type} />
          <InfoRow t={t} label="Coach" value={first.coach_number} />
          <InfoRow t={t} label="Seats" value={tickets.map((tk) => tk.seat_number).join(", ")} />
          <InfoRow t={t} label="Fare" value={`৳${booking.fare}`} />
          <InfoRow t={t} label="Payment" value={payment?.payment_method || "-"} />
        </div>
        <div className={`mt-4 pt-4 border-t ${t.divider}`}>
          <p className={`text-xs font-medium mb-2 ${t.subtext}`}>Passengers</p>
          {tickets.map((tk) => (
            <div key={tk.ticket_id} className="flex justify-between text-sm py-1">
              <span className={t.text}>{tk.passenger_name} ({tk.passenger_age}y)</span>
              <span className={t.subtext}>Seat {tk.seat_number}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 mt-5 justify-center">
        <OutlineButton t={t} onClick={() => window.print()}>Print Ticket</OutlineButton>
        <OutlineButton t={t} onClick={() => window.print()}>Download Ticket</OutlineButton>
        <PrimaryButton t={t} onClick={() => go("mybookings")}>My Bookings</PrimaryButton>
      </div>
    </div>
  );
}

function MyBookingsPage({ t, go }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => { api("/bookings").then(setList).catch((e) => setError(e.message)); }, []);

  const openBooking = async (b) => {
    try {
      const full = await api(`/bookings/${b.pnr_number}`);
      go(full.booking.effective_status === "confirmed" ? "ticket" : "payment", { booking: full, fromMyBookings: true });
    } catch (e) {
      alert(e.message);
    }
  };

  if (error) return <div className="max-w-3xl mx-auto px-4 py-8"><ErrorBanner message={error} /></div>;
  if (!list) return <div className="max-w-3xl mx-auto px-4 py-8"><p className={t.subtext}>Loading bookings…</p></div>;

  const upcoming = list.filter((b) => b.effective_status === "confirmed" || b.effective_status === "pending");
  const past = list.filter((b) => b.effective_status === "expired" || b.effective_status === "cancelled");

  const Row = ({ b }) => {
    const tone = b.effective_status === "confirmed" ? "success" : b.effective_status === "pending" ? "warn" : "danger";
    return (
      <button onClick={() => openBooking(b)} className={`w-full text-left rounded-xl border p-4 flex items-center justify-between ${t.cardBg} hover:border-blue-600`}>
        <div>
          <p className={`font-medium ${t.text}`}>{b.starts_at_station} → {b.ends_at_station}</p>
          <p className={`text-xs ${t.subtext}`}>PNR {b.pnr_number} · ৳{b.fare} · {fmtDate(b.booking_date)}</p>
        </div>
        <Badge t={t} tone={tone}>{b.effective_status[0].toUpperCase() + b.effective_status.slice(1)}</Badge>
      </button>
    );
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className={`text-xl font-bold mb-6 ${t.text}`}>My Bookings</h1>
      <h2 className={`text-sm font-semibold mb-2 ${t.subtext}`}>Upcoming</h2>
      <div className="space-y-3 mb-8">
        {upcoming.length === 0 && <p className={`text-sm ${t.subtext}`}>No upcoming bookings.</p>}
        {upcoming.map((b) => <Row key={b.pnr_number} b={b} />)}
      </div>
      <h2 className={`text-sm font-semibold mb-2 ${t.subtext}`}>Previous</h2>
      <div className="space-y-3">
        {past.length === 0 && <p className={`text-sm ${t.subtext}`}>No previous bookings.</p>}
        {past.map((b) => <Row key={b.pnr_number} b={b} />)}
      </div>
    </div>
  );
}

function ClassInfoPage({ t }) {
  const [classes, setClasses] = useState(null);
  useEffect(() => { api("/classes", { auth: false }).then(setClasses).catch(() => setClasses([])); }, []);
  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className={`text-2xl font-bold mb-6 ${t.text}`}>Class Information</h1>
      <div className="space-y-4">
        {classes === null && <p className={t.subtext}>Loading…</p>}
        {classes && classes.map((c) => (
          <div key={c.coach_type} className={`rounded-xl border p-5 ${t.cardBg}`}>
            <div className="flex items-center justify-between mb-3">
              <h2 className={`font-semibold ${t.text}`}>{c.coach_type}</h2>
              <span className={`text-sm font-semibold ${t.text}`}>৳{c.fare ?? "—"}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <InfoRow t={t} label="Seat Type" value={c.seatType} />
              <InfoRow t={t} label="Comfort" value={c.comfort} />
              <InfoRow t={t} label="AC / Non-AC" value={c.ac} />
              <InfoRow t={t} label="Typical Use" value={c.use} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AboutPage({ t }) {
  const Section = ({ title, children }) => (
    <div className="mb-6">
      <h2 className={`font-semibold mb-1.5 ${t.text}`}>{title}</h2>
      <p className={`text-sm leading-relaxed ${t.subtext}`}>{children}</p>
    </div>
  );
  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <h1 className={`text-2xl font-bold mb-6 ${t.text}`}>About Us</h1>
      <Section title="About Bangladesh Railway">Bangladesh Railway operates the national rail network, connecting major cities and districts across the country with passenger and freight services.</Section>
      <Section title="Our Purpose">This platform lets passengers search train schedules, check seat availability by class, and complete a ticket booking online from start to finish.</Section>
      <Section title="Our Vision">Make rail travel in Bangladesh easier to plan by giving passengers clear, real-time information and a simple booking flow.</Section>
      <Section title="Why use this platform?">Live seat availability by class, a guided seat-to-payment flow, a temporary hold that protects your seat while you pay, and digital tickets available anytime under My Bookings.</Section>
      <div className={`mt-8 rounded-md border p-4 text-sm ${t.cardAltBg} ${t.text}`}>This is a demonstration/prototype platform and is not an official Bangladesh Railway website.</div>
    </div>
  );
}

function ContactPage({ t }) {
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [sent, setSent] = useState(false);
  const faqs = [
    ["How do I search for a train?", "Enter your origin, destination, journey date and class on the home page, then select Search Trains."],
    ["How do I select a seat?", "After choosing a class and coach, tap any available seat in the seat map to select it."],
    ["How long is a seat held?", "Once you confirm passenger details, your seat is held for 5 minutes while you complete payment."],
    ["What happens if payment fails?", "The seat remains held until the 5-minute window ends; you can retry payment before it expires."],
    ["How can I view my booking?", "Go to My Bookings from the account menu to see upcoming and past journeys."],
  ];
  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <h1 className={`text-2xl font-bold mb-6 ${t.text}`}>Contact Us</h1>
      <div className={`rounded-xl border p-5 space-y-3 ${t.cardBg}`}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" t={t}><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={`w-full px-3 py-2.5 rounded-md border text-sm ${t.inputBg}`} /></Field>
          <Field label="Email" t={t}><input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={`w-full px-3 py-2.5 rounded-md border text-sm ${t.inputBg}`} /></Field>
        </div>
        <Field label="Subject" t={t}><input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} className={`w-full px-3 py-2.5 rounded-md border text-sm ${t.inputBg}`} /></Field>
        <Field label="Message" t={t}><textarea rows={4} value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} className={`w-full px-3 py-2.5 rounded-md border text-sm ${t.inputBg}`} /></Field>
        {sent && <p className="text-sm text-green-600">Message sent — thank you (demo, not delivered).</p>}
        <PrimaryButton t={t} onClick={() => setSent(true)}>Send Message</PrimaryButton>
      </div>
      <div className={`mt-6 rounded-xl border p-5 grid grid-cols-1 md:grid-cols-2 gap-3 ${t.cardBg}`}>
        <div className={`text-sm ${t.text}`}>&#9993; support@bdrailway-demo.example (placeholder)</div>
        <div className={`text-sm ${t.text}`}>&#9742; 16XXX (placeholder)</div>
      </div>
      <h2 className={`font-semibold mt-8 mb-3 ${t.text}`}>FAQ</h2>
      <div className="space-y-3">
        {faqs.map(([q, a]) => (
          <div key={q} className={`rounded-md border p-3 ${t.cardAltBg}`}>
            <p className={`text-sm font-medium ${t.text}`}>{q}</p>
            <p className={`text-sm mt-1 ${t.subtext}`}>{a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================== Root App ============================== */

function App() {
  const { theme, setTheme, t } = useTheme();
  const [page, setPage] = useState("home");
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [pendingSearch, setPendingSearch] = useState(null);
  const [stations, setStations] = useState([]);
  const [classTypes, setClassTypes] = useState([]);
  const [search, setSearch] = useState({ from: "DHK", to: "CTG", date: todayISO(), klass: "" });
  const [searchError, setSearchError] = useState("");
  const [ctx, setCtx] = useState({});

  useEffect(() => {
    api("/stations", { auth: false }).then(setStations).catch(() => setStations([]));
    api("/classes", { auth: false }).then((cs) => setClassTypes(cs.map((c) => c.coach_type))).catch(() => setClassTypes([]));
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      api("/auth/me").then((d) => setCurrentUser(d.user)).catch(() => localStorage.removeItem(TOKEN_KEY)).finally(() => setAuthChecked(true));
    } else {
      setAuthChecked(true);
    }
  }, []);

  const go = (p, patch) => {
    setCtx((c) => ({ ...c, ...(patch || {}) }));
    setPage(p);
    window.scrollTo(0, 0);
  };

  const validateSearch = () => {
    if (!search.from || !search.to) return "Please choose both a departure and destination station.";
    if (search.from === search.to) return "Departure and destination stations must be different.";
    if (!search.date) return "Please choose a journey date.";
    if (search.date < todayISO()) return "Journey date cannot be in the past.";
    return "";
  };

  const doSearch = () => {
    const err = validateSearch();
    if (err) { setSearchError(err); return; }
    setSearchError("");
    if (!currentUser) { setPendingSearch({ ...search }); go("login"); return; }
    go("results");
  };

  const onLogin = (token, user) => {
    localStorage.setItem(TOKEN_KEY, token);
    setCurrentUser(user);
    if (pendingSearch) { setSearch(pendingSearch); setPendingSearch(null); go("results"); }
    else go("home");
  };

  const logout = () => { localStorage.removeItem(TOKEN_KEY); setCurrentUser(null); go("home"); };

  // Enrich ctx with station city names + derived fields whenever we move
  // into the coach/seat/passenger/payment flow, so downstream pages don't
  // each have to re-derive them.
  const goBooking = (p, patch) => {
    const enriched = { ...patch };
    if (patch && (patch.tripId !== undefined || page === "results")) {
      enriched.search = {
        from: search.from, to: search.to,
        fromCity: stations.find((s) => s.station_code === search.from)?.city,
        toCity: stations.find((s) => s.station_code === search.to)?.city,
      };
    }
    go(p, enriched);
  };

  let body;
  if (!authChecked) {
    body = <div className="max-w-4xl mx-auto px-4 py-16 text-center text-sm text-slate-400">Loading…</div>;
  } else if (page === "home") {
    body = <HomePage t={t} search={search} setSearch={setSearch} doSearch={doSearch} searchError={searchError} stations={stations} classTypes={classTypes} />;
  } else if (page === "login") {
    body = <LoginPage t={t} pendingSearch={pendingSearch} onLogin={onLogin} stations={stations} />;
  } else if (page === "results") {
    body = <ResultsPage t={t} search={search} go={goBooking} stations={stations} />;
  } else if (page === "coach" && ctx.tripId) {
    body = <CoachPage t={t} go={goBooking} ctx={ctx} />;
  } else if (page === "seats" && ctx.coach) {
    body = <SeatsPage t={t} go={goBooking} ctx={ctx} />;
  } else if (page === "passenger" && ctx.seats) {
    body = <PassengerPage t={t} go={goBooking} ctx={ctx} currentUser={currentUser} />;
  } else if (page === "payment" && ctx.booking) {
    body = <PaymentPage t={t} go={goBooking} ctx={ctx} stations={stations} />;
  } else if (page === "ticket" && ctx.booking) {
    body = <TicketPage t={t} go={goBooking} ctx={ctx} stations={stations} />;
  } else if (page === "mybookings" && currentUser) {
    body = <MyBookingsPage t={t} go={goBooking} />;
  } else if (page === "classinfo") {
    body = <ClassInfoPage t={t} />;
  } else if (page === "about") {
    body = <AboutPage t={t} />;
  } else if (page === "contact") {
    body = <ContactPage t={t} />;
  } else if (page === "account" && currentUser) {
    body = (
      <div className="max-w-md mx-auto px-4 py-10">
        <h1 className={`text-2xl font-bold mb-6 ${t.text}`}>Profile</h1>
        <div className={`rounded-xl border p-5 space-y-3 ${t.cardBg}`}>
          <InfoRow t={t} label="First Name" value={currentUser.first_name} />
          <InfoRow t={t} label="Last Name" value={currentUser.last_name} />
          <InfoRow t={t} label="Email" value={currentUser.email} />
        </div>
        <div className="flex gap-3 mt-5">
          <OutlineButton t={t} onClick={() => go("mybookings")}>My Bookings</OutlineButton>
          <PrimaryButton t={t} onClick={logout}>Logout</PrimaryButton>
        </div>
      </div>
    );
  } else {
    body = <HomePage t={t} search={search} setSearch={setSearch} doSearch={doSearch} searchError={searchError} stations={stations} classTypes={classTypes} />;
  }

  return (
    <div className={`min-h-screen ${t.pageBg}`}>
      <NavBar page={page} go={(p) => { if (p === "home") setCtx({}); go(p); }} t={t} setTheme={setTheme} currentUser={currentUser} logout={logout} />
      {body}
      <footer className={`border-t mt-10 py-6 text-center text-xs ${t.divider} ${t.subtext}`}>
        BD Railway — demonstration/prototype platform, not an official Bangladesh Railway website.
      </footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
