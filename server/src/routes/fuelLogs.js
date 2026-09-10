import { Router } from 'express';
import { query, queryOne } from '../db/index.js';
import { learnFromFuelLog } from '../services/learning.js';

export const fuelLogsRouter = Router();

fuelLogsRouter.get('/', async (req, res) => {
  const { vehicle_id } = req.query;
  const rows = vehicle_id
    ? await query('SELECT * FROM fuel_logs WHERE vehicle_id = $1 ORDER BY filled_at DESC', [vehicle_id])
    : await query(`
        SELECT fl.*, v.name AS vehicle_name FROM fuel_logs fl
        JOIN vehicles v ON v.id = fl.vehicle_id
        ORDER BY fl.filled_at DESC LIMIT 100
      `);
  res.json(rows);
});

// Body: { vehicle_id, odometer_km, litres, cost_rand, filled_at? }
// This is deliberately the ONLY fuel-related input staff ever need to
// provide — exactly the three numbers on a pump slip, plus the odometer
// reading. Everything else (consumption, cost per trip) is derived.
fuelLogsRouter.post('/', async (req, res) => {
  const { vehicle_id, odometer_km, litres, cost_rand, filled_at } = req.body;
  if (!vehicle_id || !odometer_km || !litres || !cost_rand) {
    return res.status(400).json({ error: 'vehicle_id, odometer_km, litres and cost_rand are all required' });
  }

  const timestamp = filled_at || new Date().toISOString();
  const created = await queryOne(
    `INSERT INTO fuel_logs (vehicle_id, filled_at, odometer_km, litres, cost_rand)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [vehicle_id, timestamp, odometer_km, litres, cost_rand]
  );

  await learnFromFuelLog(created.id);

  // Auto-update the running fuel price from this fill-up's actual Rand/litre
  // — one less thing to enter manually in Settings. Manual entry there still
  // works as an override/fallback for days with no fill-up.
  const vehicle = await queryOne('SELECT fuel_type FROM vehicles WHERE id = $1', [vehicle_id]);
  const pricePerLitre = cost_rand / litres;
  await query(
    'INSERT INTO fuel_prices (fuel_type, price_per_litre, effective_date) VALUES ($1, $2, $3)',
    [vehicle.fuel_type, pricePerLitre, timestamp.slice(0, 10)]
  );

  const updatedVehicle = await queryOne('SELECT * FROM vehicles WHERE id = $1', [vehicle_id]);
  const savedLog = await queryOne('SELECT * FROM fuel_logs WHERE id = $1', [created.id]);

  res.json({ log: savedLog, vehicle: updatedVehicle, pricePerLitre });
});
