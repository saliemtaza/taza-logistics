import { Router } from 'express';
import { query } from '../db/index.js';
import { geocodeWarehouseAddress } from '../services/geocode.js';

export const settingsRouter = Router();

settingsRouter.get('/', async (req, res) => {
  const rows = await query('SELECT key, value FROM settings');
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const fuelPrices = await query(`
    SELECT fuel_type, price_per_litre, effective_date FROM fuel_prices
    WHERE (fuel_type, effective_date) IN (
      SELECT fuel_type, MAX(effective_date) FROM fuel_prices GROUP BY fuel_type
    )
  `);

  res.json({ settings, fuelPrices });
});

// Body: any subset of { open_time, close_time, warehouse_address }
// (warehouse_load_minutes has been retired — loading time is now learned
// per-vehicle from real Start/End Load punches, see services/learning.js)
settingsRouter.put('/', async (req, res) => {
  const addressChanged = req.body.warehouse_address !== undefined;

  for (const [key, value] of Object.entries(req.body)) {
    if (key === 'warehouse_address') {
      await query(`INSERT INTO settings (key, value) VALUES ('warehouse_lat', '') ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
      await query(`INSERT INTO settings (key, value) VALUES ('warehouse_lng', '') ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
    }
    await query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      [key, String(value)]
    );
  }

  // Geocode the warehouse itself if its address changed — a single call,
  // not repeated on every settings save unless the address actually changes.
  if (addressChanged && req.body.warehouse_address) {
    try {
      await geocodeWarehouseAddress(req.body.warehouse_address);
    } catch (err) {
      return res.status(200).json({ ok: true, warning: `Saved, but geocoding failed: ${err.message}` });
    }
  }

  res.json({ ok: true });
});

// Body: { fuel_type: 'diesel'|'petrol', price_per_litre, effective_date }
settingsRouter.post('/fuel-price', async (req, res) => {
  const { fuel_type, price_per_litre, effective_date } = req.body;
  await query(
    'INSERT INTO fuel_prices (fuel_type, price_per_litre, effective_date) VALUES ($1, $2, $3)',
    [fuel_type, price_per_litre, effective_date || new Date().toISOString().slice(0, 10)]
  );
  res.json({ ok: true });
});
