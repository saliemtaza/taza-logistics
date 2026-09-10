// Dual-backend database layer: Postgres (Supabase) when DATABASE_URL is
// set, otherwise a local SQLite file. Every route file talks to the same
// three functions — query(), queryOne(), withTransaction() — regardless of
// which backend is active, so nothing outside this file needs to know or
// care which one is in use. Keep that contract when editing this file:
// query() always returns an array of plain row objects; queryOne() the
// first row or null; withTransaction(fn) passes fn a client whose
// .query(text, params) returns { rows: [...] }, same shape on both
// backends.
//
// SQL is written throughout the app in Postgres style ($1, $2, ... for
// placeholders). The SQLite path below rewrites that to SQLite's `?` style
// before running it — safe as long as every query uses $1, $2, ... in
// strictly ascending order without reusing an index, which is the
// convention followed everywhere in this codebase.

const usePostgres = !!process.env.DATABASE_URL;

export let query;
export let queryOne;
export let withTransaction;

if (usePostgres) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('supabase.com') ? { rejectUnauthorized: false } : false,
  });

  query = async (text, params = []) => {
    const result = await pool.query(text, params);
    return result.rows;
  };

  queryOne = async (text, params = []) => {
    const rows = await query(text, params);
    return rows[0] || null;
  };

  withTransaction = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };
} else {
  const { default: Database } = await import('better-sqlite3');
  const fs = await import('fs');
  const path = await import('path');
  const { fileURLToPath } = await import('url');

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/taza-logistics.db');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const sqliteDb = new Database(DB_PATH);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');

  // First run: create tables and seed default vehicles/settings, same as
  // the Postgres migration does for a fresh Supabase project.
  const schemaPath = path.join(__dirname, 'schema.sql');
  sqliteDb.exec(fs.readFileSync(schemaPath, 'utf8'));
  const vehicleCount = sqliteDb.prepare('SELECT COUNT(*) AS c FROM vehicles').get().c;
  if (vehicleCount === 0) {
    const insertVehicle = sqliteDb.prepare(`
      INSERT INTO vehicles (name, vehicle_type, fuel_type, payload_limit_rand, crew_driver, crew_helpers, fuel_consumption_l_per_100km, avg_speed_kmh)
      VALUES (@name, @vehicle_type, @fuel_type, @payload_limit_rand, @crew_driver, @crew_helpers, @fuel_consumption_l_per_100km, @avg_speed_kmh)
    `);
    insertVehicle.run({ name: 'Isuzu NQR 500 AMT', vehicle_type: 'truck', fuel_type: 'diesel', payload_limit_rand: null, crew_driver: 1, crew_helpers: 2, fuel_consumption_l_per_100km: 20, avg_speed_kmh: 32 });
    insertVehicle.run({ name: 'GWM Steed 5 (Diesel, 2021)', vehicle_type: 'van', fuel_type: 'diesel', payload_limit_rand: 30000, crew_driver: 1, crew_helpers: 1, fuel_consumption_l_per_100km: 10, avg_speed_kmh: 38 });
    insertVehicle.run({ name: 'GWM Sailor 2.4 (Petrol, 2008)', vehicle_type: 'van', fuel_type: 'petrol', payload_limit_rand: 30000, crew_driver: 1, crew_helpers: 1, fuel_consumption_l_per_100km: 14, avg_speed_kmh: 36 });
  }
  const settingsCount = sqliteDb.prepare('SELECT COUNT(*) AS c FROM settings').get().c;
  if (settingsCount === 0) {
    const insertSetting = sqliteDb.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    insertSetting.run('open_time', '08:00');
    insertSetting.run('close_time', '16:30');
    insertSetting.run('warehouse_load_minutes', '20');
    insertSetting.run('warehouse_address', '');
    insertSetting.run('warehouse_lat', '');
    insertSetting.run('warehouse_lng', '');
  }

  // Postgres-style '$1, $2, ...' -> SQLite-style '?'. Relies on every query
  // in the app using placeholders in strictly ascending order (true
  // throughout this codebase) — see file header.
  function toSqliteSql(text) {
    return text.replace(/\$(\d+)/g, '?');
  }

  function runSqlite(text, params) {
    const converted = toSqliteSql(text);
    const stmt = sqliteDb.prepare(converted);
    const returnsRows = /^\s*(select|with)/i.test(converted) || /\breturning\b/i.test(converted);
    if (returnsRows) {
      return stmt.all(...params);
    }
    stmt.run(...params);
    return [];
  }

  query = async (text, params = []) => runSqlite(text, params);

  queryOne = async (text, params = []) => {
    const rows = await query(text, params);
    return rows[0] || null;
  };

  withTransaction = async (fn) => {
    const fakeClient = {
      query: async (text, params = []) => ({ rows: runSqlite(text, params) }),
    };
    sqliteDb.exec('BEGIN');
    try {
      const result = await fn(fakeClient);
      sqliteDb.exec('COMMIT');
      return result;
    } catch (err) {
      sqliteDb.exec('ROLLBACK');
      throw err;
    }
  };
}
