-- Taza Logistics — local SQLite schema
-- Design rules: normalized tables, no JSON blobs, no stored map geometry.
-- Every table is small-row so a future Supabase sync only ever pulls "today's" rows per device.

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                     -- e.g. 'Isuzu NQR 500 AMT'
  vehicle_type TEXT NOT NULL,              -- 'truck' | 'van'
  fuel_type TEXT NOT NULL,                 -- 'diesel' | 'petrol'
  payload_limit_rand REAL,                 -- NULL = unlimited (the NQR)
  crew_driver INTEGER NOT NULL DEFAULT 1,
  crew_helpers INTEGER NOT NULL DEFAULT 1,
  fuel_consumption_l_per_100km REAL NOT NULL, -- starting estimate, refined by learning
  avg_speed_kmh REAL NOT NULL DEFAULT 35,     -- learned average delivery-cycle speed
  avg_loading_minutes REAL NOT NULL DEFAULT 30, -- learned average warehouse loading time, refined from actual Start/End Load logs
  collection_capacity_kg REAL,             -- weight cap for stock collections; NULL = no cap
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS fuel_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fuel_type TEXT NOT NULL,                 -- 'diesel' | 'petrol'
  price_per_litre REAL NOT NULL,
  effective_date TEXT NOT NULL             -- 'YYYY-MM-DD'
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,                               -- optional account code
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL,
  lng REAL,
  geocoded_at TEXT,
  avg_dwell_minutes REAL NOT NULL DEFAULT 10, -- learned unload/paperwork time
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(active);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,                               -- optional account code
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL,
  lng REAL,
  geocoded_at TEXT,
  avg_dwell_minutes REAL NOT NULL DEFAULT 15, -- learned loading time at supplier
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(active);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  order_date TEXT NOT NULL,                -- 'YYYY-MM-DD'
  value_rand REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | planned | delivered | cancelled
  trip_stop_id INTEGER REFERENCES trip_stops(id)
);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);

CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  collection_date TEXT NOT NULL,           -- 'YYYY-MM-DD'
  amount_due_rand REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | planned | collected | cancelled
  trip_stop_id INTEGER REFERENCES trip_stops(id)
);
CREATE INDEX IF NOT EXISTS idx_collections_date ON collections(collection_date);

CREATE TABLE IF NOT EXISTS stock_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  collection_date TEXT NOT NULL,           -- 'YYYY-MM-DD'
  vehicle_id INTEGER REFERENCES vehicles(id), -- set once a vehicle is assigned (route or standalone)
  weight_kg REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | planned | collected | cancelled
  trip_stop_id INTEGER REFERENCES trip_stops(id) -- NULL for standalone (not on a delivery route)
);
CREATE INDEX IF NOT EXISTS idx_stock_collections_date ON stock_collections(collection_date);

CREATE TABLE IF NOT EXISTS vehicle_availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  date TEXT NOT NULL,
  available INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  UNIQUE(vehicle_id, date)
);

CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_date TEXT NOT NULL,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  planned_distance_km REAL,
  planned_duration_min REAL,
  planned_fuel_litres REAL,
  planned_fuel_cost_rand REAL,
  left_warehouse_at TEXT,
  back_at_warehouse_at TEXT,
  load_started_at TEXT,                    -- actual punch: when warehouse loading began
  load_ended_at TEXT,                      -- actual punch: when warehouse loading finished
  reversed INTEGER NOT NULL DEFAULT 0,     -- 1 = stop order reversed from the optimizer's default, so a later re-run of the same route hits different customers first if a day is cut short
  status TEXT NOT NULL DEFAULT 'planned'   -- planned | in_progress | complete
);
CREATE INDEX IF NOT EXISTS idx_trips_date ON trips(trip_date);

CREATE TABLE IF NOT EXISTS trip_stops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id),
  stop_type TEXT NOT NULL DEFAULT 'customer', -- 'customer' | 'supplier'
  customer_id INTEGER REFERENCES customers(id),   -- set when stop_type = 'customer'
  supplier_id INTEGER REFERENCES suppliers(id),   -- set when stop_type = 'supplier'
  seq INTEGER NOT NULL,                    -- 1-based order within the trip; supplier stock-collection
                                            -- stops normally sort after all customer stops, furthest-to-nearest
  leg_distance_km REAL,                    -- distance from previous stop (or warehouse)
  leg_duration_min REAL,
  planned_arrival TEXT,                    -- HH:MM estimate
  delivery_value_rand REAL,                -- snapshot: goods value being delivered here (counts against payload cap)
  collection_amount_rand REAL,             -- snapshot: cash due to be collected here (does not count against payload cap)
  collection_weight_kg REAL,               -- snapshot: stock weight being collected here (counts against collection_capacity_kg)
  arrived_at TEXT,                         -- actual punch timestamp
  left_at TEXT                             -- actual punch timestamp
);
CREATE INDEX IF NOT EXISTS idx_trip_stops_trip ON trip_stops(trip_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
-- expected keys: warehouse_address, warehouse_lat, warehouse_lng,
-- open_time ('08:00'), close_time ('16:30'), warehouse_load_minutes ('20'),
-- deviation_alert_minutes ('15') -- predicted delay threshold before flagging a trip

CREATE TABLE IF NOT EXISTS trip_traffic_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id),
  checked_at TEXT NOT NULL,                -- ISO timestamp of this ping
  checkpoint_pct INTEGER NOT NULL,         -- rough progress through the trip when this ping fired: 25/50/75/100
  predicted_delay_min REAL,                -- traffic-aware ETA minus the planned ETA for remaining stops
  threshold_exceeded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_trip_traffic_checks_trip ON trip_traffic_checks(trip_id);

CREATE TABLE IF NOT EXISTS fuel_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  filled_at TEXT NOT NULL,                 -- ISO timestamp of the fill-up
  odometer_km REAL NOT NULL,               -- odometer reading AT this fill-up
  litres REAL NOT NULL,                    -- litres put in (from the pump slip)
  cost_rand REAL NOT NULL,                 -- total Rand paid (from the pump slip)
  km_since_last REAL,                      -- computed: odometer delta from the previous fill-up
  l_per_100km_observed REAL                -- computed: this interval's actual consumption
);
CREATE INDEX IF NOT EXISTS idx_fuel_logs_vehicle ON fuel_logs(vehicle_id, filled_at);

