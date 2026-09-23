import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { query, queryOne, withTransaction } from '../db/index.js';
import { geocodeMissingCustomers, regeocodeCustomer } from '../services/geocode.js';

const upload = multer({ storage: multer.memoryStorage() });
export const customersRouter = Router();

// Looks up a value on a CSV row by trying a list of possible header names,
// case-insensitively and ignoring surrounding spaces — so "Display Name",
// "display_name", "  Name  " etc. all resolve the same way. Returns the
// first non-empty match, or undefined if none of the aliases are present.
function getField(row, aliases) {
  const normalizedRow = {};
  for (const key of Object.keys(row)) {
    normalizedRow[key.trim().toLowerCase()] = row[key];
  }
  for (const alias of aliases) {
    const value = normalizedRow[alias.toLowerCase()];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

// Some exports (e.g. Zoho Books/Invoice) split the address across several
// billing columns instead of one combined field. Prefer a single address
// column if present, otherwise stitch the billing columns together.
function getAddress(row) {
  const direct = getField(row, ['address', 'delivery address', 'address 1']);
  if (direct) return direct;

  const parts = [
    getField(row, ['billing address']),
    getField(row, ['billing street2']),
    getField(row, ['billing city']),
    getField(row, ['billing state']),
    getField(row, ['billing code']),
    getField(row, ['billing country']),
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

// Some exports already include coordinates (e.g. Zoho's "Billing
// Latitude"/"Billing Longitude"). When present and valid, use them
// directly instead of spending a Google geocode call on that row.
function getLatLng(row) {
  const latRaw = getField(row, ['billing latitude', 'latitude', 'lat']);
  const lngRaw = getField(row, ['billing longitude', 'longitude', 'lng']);
  const lat = latRaw !== undefined ? Number(latRaw) : NaN;
  const lng = lngRaw !== undefined ? Number(lngRaw) : NaN;
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
    return { lat, lng };
  }
  return { lat: null, lng: null };
}

customersRouter.get('/', async (req, res) => {
  res.json(await query('SELECT * FROM customers WHERE active = true ORDER BY name'));
});

// Expected CSV columns (case-insensitive): code, name, address — also
// accepts common accounting-system export aliases (e.g. "Display Name",
// "Billing Address", Zoho's "Contact ID" as code). If the file splits the
// address across several billing columns (address/street2/city/state/
// code/country) they're stitched into one address string. If the file
// already includes coordinates (e.g. "Billing Latitude"/"Billing
// Longitude"), those are used directly instead of geocoding that row.
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
      const code = getField(row, ['code', 'contact id', 'account number', 'customer code', 'customer number']) || null;
      const name = getField(row, ['name', 'display name', 'customer name', 'company name']);
      const address = getAddress(row);
      if (!name || !address) { skipped += 1; continue; }
      const { lat, lng } = getLatLng(row);
      const hasCoords = lat !== null && lng !== null;

      const existingResult = code
        ? await client.query('SELECT id, address, lat, lng FROM customers WHERE code = $1', [code])
        : await client.query('SELECT id, address, lat, lng FROM customers WHERE name = $1', [name]);
      const existing = existingResult.rows[0];

      if (existing) {
        const addressChanged = existing.address !== address;
        const missingCoords = existing.lat === null || existing.lat === undefined
          || existing.lng === null || existing.lng === undefined;

        if (addressChanged || (hasCoords && missingCoords)) {
          if (hasCoords) {
            // File already supplies coordinates — use them directly and
            // skip the paid Google geocode call entirely. Also clears
            // geocode_failed_at: if this row previously failed geocoding
            // and now arrives with real coordinates, that's resolved.
            await client.query(
              `UPDATE customers SET address = $1, lat = $2, lng = $3, geocoded_at = $4, geocode_failed_at = NULL
               WHERE id = $5`,
              [address, lat, lng, new Date().toISOString(), existing.id]
            );
          } else {
            // No coordinates in the file — clear cached ones so the
            // background geocoder picks this customer up. Also clears
            // geocode_failed_at: a changed address is a fresh address as
            // far as geocoding is concerned, even if the OLD address had
            // permanently failed — without this, a corrected address would
            // stay silently excluded from auto-geocoding forever.
            await client.query(
              `UPDATE customers SET address = $1, lat = NULL, lng = NULL, geocoded_at = NULL, geocode_failed_at = NULL
               WHERE id = $2`,
              [address, existing.id]
            );
          }
          updated += 1;
        } else {
          skipped += 1;
        }
        await client.query('UPDATE customers SET active = true WHERE id = $1', [existing.id]);
        seenIds.push(existing.id);
      } else {
        const insertResult = await client.query(
          `INSERT INTO customers (code, name, address, lat, lng, geocoded_at)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [code, name, address, lat, lng, hasCoords ? new Date().toISOString() : null]
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
