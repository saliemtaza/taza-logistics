import { query, withTransaction } from '../db/index.js';

// Archive files go to Supabase Storage when configured (SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY set), or a local disk folder otherwise — same
// dual-backend pattern as the database layer, and for the same reason:
// local testing shouldn't require a Supabase project, but a deployed host
// (Render, or any serverless host) can't rely on local disk surviving
// between deploys/restarts.
const useSupabaseStorage = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const BUCKET = 'trip-archives';

let readArchive, writeArchive, listArchiveNames, readArchiveBuffer;

if (useSupabaseStorage) {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  readArchive = async (name) => {
    const { data, error } = await supabase.storage.from(BUCKET).download(name);
    if (error) return []; // not found yet — treat as empty
    return JSON.parse(await data.text());
  };
  writeArchive = async (name, content) => {
    const blob = new Blob([JSON.stringify(content)], { type: 'application/json' });
    const { error } = await supabase.storage.from(BUCKET).upload(name, blob, { upsert: true, contentType: 'application/json' });
    if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);
  };
  listArchiveNames = async () => {
    const { data, error } = await supabase.storage.from(BUCKET).list();
    if (error) throw new Error(`Supabase Storage list failed: ${error.message}`);
    return (data || [])
      .filter((f) => f.name.endsWith('.json'))
      .map((f) => ({ name: f.name, sizeBytes: f.metadata?.size ?? 0 }));
  };
  readArchiveBuffer = async (name) => {
    const { data, error } = await supabase.storage.from(BUCKET).download(name);
    if (error) throw new Error('Archive file not found');
    return Buffer.from(await data.arrayBuffer());
  };
} else {
  const fs = await import('fs');
  const path = await import('path');
  const { fileURLToPath } = await import('url');

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const ARCHIVE_DIR = process.env.ARCHIVE_DIR || path.join(__dirname, '../../data/archives');
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

  readArchive = async (name) => {
    const filePath = path.join(ARCHIVE_DIR, name);
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : [];
  };
  writeArchive = async (name, content) => {
    fs.writeFileSync(path.join(ARCHIVE_DIR, name), JSON.stringify(content));
  };
  listArchiveNames = async () => {
    return fs.readdirSync(ARCHIVE_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ name: f, sizeBytes: fs.statSync(path.join(ARCHIVE_DIR, f)).size }))
      .sort((a, b) => a.name.localeCompare(b.name));
  };
  readArchiveBuffer = async (name) => {
    const filePath = path.join(ARCHIVE_DIR, name);
    if (!fs.existsSync(filePath)) throw new Error('Archive file not found');
    return fs.readFileSync(filePath);
  };
}

export async function previewArchive(beforeDate) {
  const trips = await query(
    `SELECT trip_date FROM trips WHERE trip_date < $1 AND status = 'complete' ORDER BY trip_date`,
    [beforeDate]
  );
  if (trips.length === 0) return { tripCount: 0, earliestDate: null, latestDate: null };
  return {
    tripCount: trips.length,
    earliestDate: trips[0].trip_date,
    latestDate: trips[trips.length - 1].trip_date,
  };
}

/**
 * Archive every COMPLETE trip dated before `beforeDate`. Groups trips by
 * calendar month into one JSON file per month (merging with any existing
 * file for that month, so running this repeatedly is safe and additive).
 * Orders referencing archived trip_stops are detached (trip_stop_id set to
 * NULL) rather than deleted — the order record itself stays, just without a
 * dangling link into a now-archived trip.
 */
export async function runArchive(beforeDate) {
  const trips = await query(
    `SELECT * FROM trips WHERE trip_date < $1 AND status = 'complete'`,
    [beforeDate]
  );
  if (trips.length === 0) return { archived: 0, files: [] };

  const byMonth = {};
  for (const trip of trips) {
    const stops = await query(`
      SELECT ts.*, c.name AS customer_name, c.address FROM trip_stops ts
      JOIN customers c ON c.id = ts.customer_id
      WHERE ts.trip_id = $1 ORDER BY ts.seq
    `, [trip.id]);
    const month = String(trip.trip_date).slice(0, 7); // 'YYYY-MM'
    (byMonth[month] ||= []).push({ ...trip, stops });
  }

  const filesWritten = [];

  // Write archive files FIRST, outside the DB transaction — if a Storage
  // upload fails partway through, nothing has been deleted from the live
  // database yet. Only once every file is safely written do we remove the
  // archived rows.
  for (const [month, monthTrips] of Object.entries(byMonth)) {
    const fileName = `trips-${month}.json`;
    const existing = await readArchive(fileName);
    await writeArchive(fileName, [...existing, ...monthTrips]);
    filesWritten.push(fileName);
  }

  await withTransaction(async (client) => {
    for (const monthTrips of Object.values(byMonth)) {
      const tripIds = monthTrips.map((t) => t.id);

      // Detach orders from the trip_stops we're about to delete (required —
      // the foreign key would otherwise block the delete).
      for (const tripId of tripIds) {
        await client.query(`
          UPDATE orders SET trip_stop_id = NULL
          WHERE trip_stop_id IN (SELECT id FROM trip_stops WHERE trip_id = $1)
        `, [tripId]);
        await client.query('DELETE FROM trip_stops WHERE trip_id = $1', [tripId]);
        await client.query('DELETE FROM trips WHERE id = $1', [tripId]);
      }
    }
  });

  return { archived: trips.length, files: filesWritten };
}

export async function listArchiveFiles() {
  return listArchiveNames();
}

export async function getArchiveFileBuffer(filename) {
  // Guard against path traversal — only allow filenames we generated.
  if (!/^trips-\d{4}-\d{2}\.json$/.test(filename)) throw new Error('Invalid archive filename');
  return readArchiveBuffer(filename);
}
