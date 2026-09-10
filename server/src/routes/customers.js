import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { query, queryOne, withTransaction } from '../db/index.js';
import { geocodeMissingCustomers, regeocodeCustomer } from '../services/geocode.js';

const upload = multer({ storage: multer.memoryStorage() });
export const customersRouter = Router();

customersRouter.get('/', async (req, res) => {
  res.json(await query('SELECT * FROM customers WHERE active = true ORDER BY name'));
});

// Expected CSV columns (case-insensitive): code, name, address
// Existing customers are matched by code (if present) or by name, and updated
// in place — re-uploading the same file is safe and never duplicates rows,
// and never re-geocodes an address that hasn't changed.
//
// full_sync (form field, default true): treat this upload as the complete
// current customer list from your accounting system. Any active customer
// NOT present in the file gets soft-deactivated (active = false) rather
// than deleted, so historical orders/trips referencing them stay intact.
// As a safety net, if that would deactivate more than half of current
// active customers, nothing is deactivated and a warning is returned
// instead — protects against accidentally uploading a partial file.
customersRouter.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const fullSync = req.body.full_sync !== 'false'; // default true

  let records;
  try {
    records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    return res.status(400).json({ error: `Could not parse CSV: ${err.message}` });
  }

  let inserted = 0, updated = 0, skipped = 0;
  const seenIds = [];

  await withTransaction(async (client) => {
    for (const row of records) {
      const code = row.code || row.Code || null;
      const name = row.name || row.Name;
      const address = row.address || row.Address;
      if (!name || !address) { skipped += 1; continue; }

      const existingResult = code
        ? await client.query('SELECT id FROM customers WHERE code = $1', [code])
        : await client.query('SELECT id FROM customers WHERE name = $1', [name]);
      const existing = existingResult.rows[0];

      if (existing) {
        // Only clear cached coordinates if the address actually changed —
        // avoids needlessly re-geocoding (and re-billing) unchanged rows.
        const updateResult = await client.query(
          `UPDATE customers SET address = $1, lat = NULL, lng = NULL, geocoded_at = NULL
           WHERE id = $2 AND address != $1`,
          [address, existing.id]
        );
        if (updateResult.rowCount === 0) skipped += 1; else updated += 1;
        await client.query('UPDATE customers SET active = true WHERE id = $1', [existing.id]);
        seenIds.push(existing.id);
      } else {
        const insertResult = await client.query(
          'INSERT INTO customers (code, name, address) VALUES ($1, $2, $3) RETURNING id',
          [code, name, address]
        );
        inserted += 1;
        seenIds.push(insertResult.rows[0].id);
      }
    }
  });

  let deactivated = 0;
  let deactivationSkipped = false;
  if (fullSync && seenIds.length > 0) {
    const activeRows = await query('SELECT id FROM customers WHERE active = true');
    const activeIds = activeRows.map((r) => r.id);
    const seenSet = new Set(seenIds);
    const toDeactivate = activeIds.filter((id) => !seenSet.has(id));

    if (toDeactivate.length > activeIds.length * 0.5) {
      // Looks like a partial file, not the full customer list — refuse to
      // mass-deactivate and surface it instead of silently wiping most of
      // the active customer base.
      deactivationSkipped = true;
    } else if (toDeactivate.length > 0) {
      // Individual statements rather than a WHERE id = ANY(array) — SQLite
      // has no array parameter type, and this only ever runs over a small
      // list of departing customers, so the loop costs nothing meaningful.
      for (const id of toDeactivate) {
        await query('UPDATE customers SET active = false WHERE id = $1', [id]);
      }
      deactivated = toDeactivate.length;
    }
  }

  const geocodeResult = await geocodeMissingCustomers();

  res.json({
    inserted, updated, skipped, deactivated, deactivationSkipped,
    geocoded: geocodeResult.succeeded, geocodeFailures: geocodeResult.failed,
    stillPending: geocodeResult.stillPending,
  });
});

customersRouter.post('/:id/regeocode', async (req, res) => {
  try {
    const result = await regeocodeCustomer(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Geocodes the next batch (up to 40) of customers still missing
// coordinates. The client calls this repeatedly (showing progress) until
// stillPending reaches 0 — keeps each request short instead of one huge
// synchronous loop over the whole customer base.
customersRouter.post('/geocode-batch', async (req, res) => {
  const result = await geocodeMissingCustomers();
  res.json(result);
});
