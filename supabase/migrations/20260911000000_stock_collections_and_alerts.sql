-- Taza Logistics — adds supplier stock collections, route reversal, and
-- deviation-alert traffic checks. Purely additive: no existing table's
-- data is touched, only new columns/tables. Same conventions as the
-- initial migration (numeric(12,2) for Rand, double precision for other
-- measurements, boolean flags, timestamptz).

-- ---------------------------------------------------------------------
-- Suppliers — mirrors customers, used for stock-collection pickups
-- ---------------------------------------------------------------------

create table suppliers (
  id bigint generated always as identity primary key,
  code text,
  name text not null,
  address text not null,
  lat double precision,
  lng double precision,
  geocoded_at timestamptz,
  avg_dwell_minutes double precision not null default 15,
  active boolean not null default true
);
create index idx_suppliers_active on suppliers(active);

-- ---------------------------------------------------------------------
-- Vehicles — weight-based cap for stock collections (separate from the
-- existing Rand-based delivery payload cap)
-- ---------------------------------------------------------------------

alter table vehicles add column collection_capacity_kg double precision;

-- ---------------------------------------------------------------------
-- Trips — route-reversal toggle
-- ---------------------------------------------------------------------

alter table trips add column reversed boolean not null default false;

-- ---------------------------------------------------------------------
-- Trip stops — now represent either a customer delivery/collection stop
-- or a supplier stock-collection stop
-- ---------------------------------------------------------------------

alter table trip_stops add column stop_type text not null default 'customer'
  check (stop_type in ('customer', 'supplier'));
alter table trip_stops alter column customer_id drop not null;
alter table trip_stops add column supplier_id bigint references suppliers(id);
alter table trip_stops add column collection_weight_kg double precision;

alter table trip_stops add constraint trip_stops_stop_ref_check check (
  (stop_type = 'customer' and customer_id is not null and supplier_id is null) or
  (stop_type = 'supplier' and supplier_id is not null and customer_id is null)
);

-- ---------------------------------------------------------------------
-- Stock collections — mirrors collections/orders, but weight-based and
-- may exist without any trip (standalone log entry not tied to a route)
-- ---------------------------------------------------------------------

create table stock_collections (
  id bigint generated always as identity primary key,
  supplier_id bigint not null references suppliers(id),
  collection_date date not null,
  vehicle_id bigint references vehicles(id),
  weight_kg double precision not null,
  status text not null default 'pending' check (status in ('pending', 'planned', 'collected', 'cancelled')),
  trip_stop_id bigint references trip_stops(id)
);
create index idx_stock_collections_date on stock_collections(collection_date);

-- ---------------------------------------------------------------------
-- Traffic deviation checks — logs each in-trip traffic-aware ping
-- ---------------------------------------------------------------------

create table trip_traffic_checks (
  id bigint generated always as identity primary key,
  trip_id bigint not null references trips(id),
  checked_at timestamptz not null,
  checkpoint_pct integer not null,         -- 25 / 50 / 75 / 100
  predicted_delay_min double precision,
  threshold_exceeded boolean not null default false
);
create index idx_trip_traffic_checks_trip on trip_traffic_checks(trip_id);

-- New setting: how many minutes of predicted delay before a trip is
-- flagged. Inserted with on conflict do nothing since (unlike the initial
-- migration) this one may reasonably be re-run.
insert into settings (key, value) values ('deviation_alert_minutes', '15')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Row Level Security — same permissive policy as every other table
-- ---------------------------------------------------------------------

alter table suppliers enable row level security;
alter table stock_collections enable row level security;
alter table trip_traffic_checks enable row level security;

create policy "Authenticated users have full access" on suppliers for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on stock_collections for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on trip_traffic_checks for all to authenticated using (true) with check (true);
