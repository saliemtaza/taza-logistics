-- Taza Logistics — Supabase (Postgres) schema
-- Ported from server/src/db/schema.sql (SQLite). Same tables, same design
-- rules (normalized, no blobs, no stored map geometry), with proper
-- Postgres types where SQLite made us fudge it:
--   - money fields -> numeric(12,2), not floating point (avoids rounding
--     drift on Rand values that gate real decisions like the payload cap)
--   - true/false flags -> boolean, not integer 0/1
--   - dates -> date, timestamps -> timestamptz, instead of plain text
-- Tables are created in dependency order (Postgres validates foreign keys
-- immediately, unlike SQLite, so trip_stops must exist before orders/
-- collections that reference it).

create table vehicles (
  id bigint generated always as identity primary key,
  name text not null,
  vehicle_type text not null check (vehicle_type in ('truck', 'van')),
  fuel_type text not null check (fuel_type in ('diesel', 'petrol')),
  payload_limit_rand numeric(12,2),          -- null = unlimited (the NQR)
  crew_driver integer not null default 1,
  crew_helpers integer not null default 1,
  fuel_consumption_l_per_100km double precision not null,
  avg_speed_kmh double precision not null default 35,
  active boolean not null default true
);

create table fuel_prices (
  id bigint generated always as identity primary key,
  fuel_type text not null check (fuel_type in ('diesel', 'petrol')),
  price_per_litre numeric(12,2) not null,
  effective_date date not null
);

create table customers (
  id bigint generated always as identity primary key,
  code text,
  name text not null,
  address text not null,
  lat double precision,
  lng double precision,
  geocoded_at timestamptz,
  avg_dwell_minutes double precision not null default 10,
  active boolean not null default true
);
create index idx_customers_active on customers(active);

create table trips (
  id bigint generated always as identity primary key,
  trip_date date not null,
  vehicle_id bigint not null references vehicles(id),
  planned_distance_km double precision,
  planned_duration_min double precision,
  planned_fuel_litres double precision,
  planned_fuel_cost_rand numeric(12,2),
  left_warehouse_at timestamptz,
  back_at_warehouse_at timestamptz,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'complete'))
);
create index idx_trips_date on trips(trip_date);

create table trip_stops (
  id bigint generated always as identity primary key,
  trip_id bigint not null references trips(id),
  customer_id bigint not null references customers(id),
  seq integer not null,
  leg_distance_km double precision,
  leg_duration_min double precision,
  planned_arrival text,
  delivery_value_rand numeric(12,2),
  collection_amount_rand numeric(12,2),
  arrived_at timestamptz,
  left_at timestamptz
);
create index idx_trip_stops_trip on trip_stops(trip_id);

create table orders (
  id bigint generated always as identity primary key,
  customer_id bigint not null references customers(id),
  order_date date not null,
  value_rand numeric(12,2) not null,
  status text not null default 'pending' check (status in ('pending', 'planned', 'delivered', 'cancelled')),
  trip_stop_id bigint references trip_stops(id)
);
create index idx_orders_date on orders(order_date);

create table collections (
  id bigint generated always as identity primary key,
  customer_id bigint not null references customers(id),
  collection_date date not null,
  amount_due_rand numeric(12,2) not null,
  status text not null default 'pending' check (status in ('pending', 'planned', 'collected', 'cancelled')),
  trip_stop_id bigint references trip_stops(id)
);
create index idx_collections_date on collections(collection_date);

create table vehicle_availability (
  id bigint generated always as identity primary key,
  vehicle_id bigint not null references vehicles(id),
  date date not null,
  available boolean not null default true,
  reason text,
  unique (vehicle_id, date)
);

create table settings (
  key text primary key,
  value text
);
-- expected keys: warehouse_address, warehouse_lat, warehouse_lng,
-- open_time ('08:00'), close_time ('16:30'), warehouse_load_minutes ('20')

create table fuel_logs (
  id bigint generated always as identity primary key,
  vehicle_id bigint not null references vehicles(id),
  filled_at timestamptz not null,
  odometer_km double precision not null,
  litres double precision not null,
  cost_rand numeric(12,2) not null,
  km_since_last double precision,
  l_per_100km_observed double precision
);
create index idx_fuel_logs_vehicle on fuel_logs(vehicle_id, filled_at);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
-- Supabase flags any table without RLS as a security warning, so it's
-- enabled everywhere from day one rather than left off "for now" — the
-- policy below is intentionally permissive (any authenticated user can do
-- anything), matching a small trusted team with no per-driver login model
-- yet decided. Tighten later by replacing these with per-role policies
-- once an auth model (e.g. one Supabase Auth user per driver) is in place.

alter table vehicles enable row level security;
alter table fuel_prices enable row level security;
alter table customers enable row level security;
alter table trips enable row level security;
alter table trip_stops enable row level security;
alter table orders enable row level security;
alter table collections enable row level security;
alter table vehicle_availability enable row level security;
alter table settings enable row level security;
alter table fuel_logs enable row level security;

create policy "Authenticated users have full access" on vehicles for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on fuel_prices for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on customers for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on trips for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on trip_stops for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on orders for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on collections for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on vehicle_availability for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on settings for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on fuel_logs for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- Seed data — same defaults the local SQLite version auto-seeded on first
-- run. Safe to run once on a fresh project; re-running this migration
-- would duplicate these rows, so don't re-apply it to an already-seeded
-- database.
-- ---------------------------------------------------------------------

insert into vehicles (name, vehicle_type, fuel_type, payload_limit_rand, crew_driver, crew_helpers, fuel_consumption_l_per_100km, avg_speed_kmh) values
  ('Isuzu NQR 500 AMT', 'truck', 'diesel', null, 1, 2, 20, 32),
  ('GWM Steed 5 (Diesel, 2021)', 'van', 'diesel', 30000, 1, 1, 10, 38),
  ('GWM Sailor 2.4 (Petrol, 2008)', 'van', 'petrol', 30000, 1, 1, 14, 36);

insert into settings (key, value) values
  ('open_time', '08:00'),
  ('close_time', '16:30'),
  ('warehouse_load_minutes', '20'),
  ('warehouse_address', ''),
  ('warehouse_lat', ''),
  ('warehouse_lng', '');

-- ---------------------------------------------------------------------
-- Storage bucket for archived trip history (server/src/services/archive.js)
-- ---------------------------------------------------------------------
-- Private bucket — archives contain customer names/addresses and Rand
-- values, so this should never be public. Access goes through the server
-- using the service role key, which bypasses these policies entirely; the
-- authenticated-role policy below exists only so that if the client ever
-- needs to read an archive directly in the future, it can.

insert into storage.buckets (id, name, public)
values ('trip-archives', 'trip-archives', false)
on conflict (id) do nothing;

create policy "Authenticated users can read trip archives"
on storage.objects for select
to authenticated
using (bucket_id = 'trip-archives');
