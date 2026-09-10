# Taza Logistics

A route-planning and delivery-tracking app, built for Taza Distributors.
Runs against local SQLite for quick testing with zero setup, or against
Supabase Postgres for anything shared/deployed — same code, same features,
switched by one environment variable.

## What it does

- Upload your customer database (CSV) once; addresses are geocoded and
  cached — never re-looked-up unless the address changes.
- Build each day's order list from that database (customer + Rand value) —
  either tick-box by hand, or upload a CSV export from your order system;
  either way, the tick-box screen is your review/confirm step before
  generating the route.
- Cash collections are tracked separately from delivery orders (a customer
  can owe cash with no delivery today, or have both) and get merged into
  the same stop on the route — the driver just sees what's expected at
  each stop, no in-field classification needed.
- Generates an optimised route plan: merges today's deliveries and
  collections into stops, respects each vehicle's Rand payload cap (goods
  value only — collections don't count against it) and the day's time
  window, and assigns vehicles by fuel efficiency — the LEAST efficient
  vehicle gets the shortest routes (where its higher consumption costs the
  least), and the MOST efficient vehicle is saved for the longest routes.
- Vehicles are managed in-app (add, edit, deactivate) — adding a new
  vehicle to the fleet never requires touching code. Same-day availability
  (breakdown, driver off) is set from the Route Plan screen before
  generating.
- Punch-clock tracking: Left Warehouse, Arrived/Left per customer, Back at
  Warehouse — on any phone/tablet on the same network, working offline in
  the field if needed.
- Learns over time: as real trips complete, the app quietly refines its
  estimates of vehicle speed and per-customer dwell time from what actually
  happened. Fuel consumption is learned separately from fill-up logs — see
  below — never from staff estimating litres per trip.
- Tracks fuel cost per trip against the current fuel price, per vehicle.
- Fuel Log tab: log every fill-up (odometer reading, litres, Rand paid —
  exactly what's on the pump slip). The app works out real L/100km itself
  from the distance driven since the last fill-up, and keeps the fuel price
  used in cost estimates current from the actual Rand/litre paid. Nobody
  has to estimate or track fuel per individual trip.
- Loading sheet: each vehicle's route can print a physical loading order —
  last delivery stop loaded first (deepest in the vehicle), first stop
  loaded last (nearest the door, so it's the first thing off).

## Architecture at a glance

- `server/` — Node/Express API. Database layer supports SQLite
  (`better-sqlite3`, zero setup, for local testing) and Postgres (`pg`, for
  Supabase) behind the same interface — set `DATABASE_URL` to switch.
  Archived trip history goes to Supabase Storage when configured, local
  disk otherwise. Normalized tables, no blobs, small rows throughout — kept
  cheap and fast to sync across multiple devices either way.
- `client/` — React/Vite web app. Runs in any browser — locally on the
  same WiFi as the server, or from anywhere once deployed.
- `supabase/migrations/` — the Postgres schema (tables, indexes, Row Level
  Security, Storage bucket) as a single SQL file to run once in the
  Supabase SQL Editor.
- **Planning** (at the warehouse, online) uses Google Maps for geocoding and
  real road distances.
- **Field execution** (drivers, out at customers) works from a locally
  cached route — no live map calls required — because Google's terms don't
  allow offline map caching, and driver signal in the field can't be relied
  on anyway. Mobile data is a fallback only, not a requirement.

## First-time setup

### 1. Server

```bash
cd server
cp .env.example .env
# edit .env: add your Google Maps API key
npm install
npm run dev
```

By default this runs against a local SQLite file (created automatically) —
nothing else to set up. To point it at a Supabase/Postgres database instead
(for testing against what you'll actually deploy), set `DATABASE_URL` in
`.env` — the server picks whichever backend is configured automatically,
using the exact same code either way.

The server starts on port 4000 and listens on all network interfaces, so
other devices on the same WiFi can reach it.

**Find this machine's LAN IP** (needed for phones/tablets to connect):
- Windows: `ipconfig` → look for "IPv4 Address"
- Mac/Linux: `ifconfig` (or `ip addr`) → look for something like `192.168.x.x`

### 2. Client

```bash
cd client
npm install
npm run dev
```

Open the printed URL (e.g. `http://localhost:5173`) on the dispatch
computer. On a phone/tablet, browse instead to
`http://<dispatch-machine-LAN-IP>:5173`.

On each device, go to **Settings → Server address** and enter
`http://<dispatch-machine-LAN-IP>:4000` so it can reach the API — this only
needs doing once per device (it's saved locally).

### 3. Google Maps API key

1. Create a project at https://console.cloud.google.com
2. Enable the **Geocoding API** and **Routes API**
3. Create an API key, restrict it to those two APIs
4. Add a billing account (required by Google even for free-tier usage) and
   set a budget alert as a safety net
5. Paste the key into `server/.env`

At your volumes (~500 customers geocoded once, ~20 route calculations a
day) you should comfortably stay within Google's free monthly allowance.

## Deploying (Render + Supabase)

Once you're ready to move off local-only:

### 1. Create the Supabase project
1. Create a project at https://supabase.com/dashboard — free tier.
2. Open the SQL Editor and run the contents of
   `supabase/migrations/20250101000000_init.sql` once. This creates every
   table, enables Row Level Security, and creates the private
   `trip-archives` Storage bucket used for archived trip history.
3. From Project Settings → Database, copy the connection string — this is
   your `DATABASE_URL`.
4. From Project Settings → API, copy the Project URL and the
   `service_role` key (NOT the anon key — the server needs the elevated
   key to write archives; never expose this key to the client) — these are
   your `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

### 2. Deploy to Render
1. Push this repo to GitHub (see below) if you haven't already.
2. In Render, "New" → "Blueprint" → point it at your GitHub repo. It will
   read `render.yaml` and create both services automatically:
   - `taza-logistics-api` — the Express server (free web service)
   - `taza-logistics-client` — the built React app (free static site,
     never sleeps)
3. On the `taza-logistics-api` service, set the environment variables it
   asks for: `GOOGLE_MAPS_API_KEY`, `DATABASE_URL`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`.
4. Once both services are live, open the client's Render URL, go to
   **Settings → Server address**, and enter the API service's Render URL.
   Do this once per device (dispatcher's computer, each driver's phone) —
   after that, everyone hits the same public URLs from anywhere with
   internet, not just warehouse WiFi.

**Worth knowing:** the free API service sleeps after 15 minutes idle and
takes 30-60 seconds to wake on the next request — fine for this app's usage
pattern (a morning planning burst, then occasional punches through the
day), but worth expecting rather than being surprised by. Move to Render's
$7/month Starter plan if that stops being acceptable. To pause entirely
(e.g. if Supabase usage becomes a concern while you're still validating),
you can suspend either the Render service or the Supabase project
independently from their own dashboards — no code changes needed either
way.

## Daily workflow

1. **Customers** tab — upload/update your customer CSV (columns: `code`
   optional, `name`, `address`). Only new/changed addresses get geocoded.
2. **Today's Orders** tab — tick today's customers and enter each order's
   Rand value.
3. **Route Plan** tab — generate the plan. Review vehicle assignments,
   stop order, and estimated fuel cost. Anything that didn't fit shows
   under "Could not fit today."
4. **Field / Punch Clock** tab (on each vehicle's device) — while still at
   the warehouse and online, tap "Load today's plan" to cache it locally.
   From then on the device works offline: Left Warehouse → Arrived/Left at
   each stop → Back at Warehouse. Punches sync automatically once the
   device is back online.
5. **Fuel Log** tab — whenever a vehicle is filled up, log the odometer
   reading, litres, and Rand paid (from the slip). That's the only fuel
   input needed, ever.
6. **Settings** tab — warehouse address/hours and fleet config. Fuel prices
   here are also kept current automatically from fill-ups, but can be
   overridden manually for days with no fill-up logged.

## The learning loop

Every completed trip feeds back into:
- **Vehicle average speed** — refined from actual drive time between punches.
- **Customer dwell time** — refined from actual arrived→left time per stop.

Every fill-up feeds back into:
- **Fuel consumption (L/100km)** — computed directly from the odometer
  distance since the *previous* fill-up and this fill-up's litres (the
  standard "brim-to-brim" method fleets use) — not estimated by anyone.
- **Current fuel price** — taken from the actual Rand paid ÷ litres.

Estimates move gradually (a rolling average, not an instant overwrite) so
one unusual day (traffic jam, chatty customer) won't skew things — it takes
a consistent pattern to shift the numbers.

## Data lifecycle: live vs. archived

The live database stays small on purpose:

- **Live (queried daily):** vehicles, customers, settings, fuel prices,
  current + recent orders and trips.
- **Archived:** completed trips older than a cutoff you choose, exported as
  one compact JSON file per month — to Supabase Storage when configured,
  local disk otherwise.

This split is safe because the learning model doesn't need raw history to
function — vehicle speed, customer dwell time, and fuel consumption are
each stored as a single running-average number that updates the moment a
trip completes. Raw trip history exists only for your own record-keeping,
so it can be moved out of the live database entirely without affecting
route planning quality.

Use the **History / Archive** tab to preview and run archiving (default
60-day retention, adjustable). Archived files are downloadable any time.

## Simulated egress (once on Supabase)

Assumptions: 5 devices (1 dispatcher + 4 field), 26 working days/month,
JSON responses only (no images/blobs), each device only ever fetching
today's rows (never full history — enforced by the schema and the archive
split above).

| Activity | Size | Frequency | Daily total |
|---|---|---|---|
| Dispatcher: full customer list (500 rows) | ~250 B/row | 1×/day | ~125 KB |
| Dispatcher: route plan (~20 stops) | ~7 KB | ~3×/day | ~21 KB |
| Dispatcher: misc (orders, settings, fuel log) | — | — | ~50 KB |
| Field device: today's trip (own vehicle) | ~2–3 KB | 1×/day | ~3 KB × 4 |
| Field device: punch acknowledgements | ~100 B | ~20/day | ~2 KB × 4 |

**Daily total: ~223 KB → Monthly: ~5.8 MB** — about 0.1% of a 5 GB egress
budget, even before padding for margin. The main way this could balloon
later is adding delivery-proof photos (a single 2 MB photo × 20 stops/day
would alone use ~1 GB/month) — if that's ever wanted, route it through
Supabase Storage with client-side compression, not the database, and budget
for it separately rather than assuming it fits in the same envelope.

