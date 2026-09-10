import { Router } from 'express';
import { query, queryOne } from '../db/index.js';

export const vehiclesRouter = Router();

vehiclesRouter.get('/', async (req, res) => {
  res.json(await query('SELECT * FROM vehicles ORDER BY id'));
});

vehiclesRouter.put('/:id', async (req, res) => {
  const { name, payload_limit_rand, fuel_consumption_l_per_100km, avg_speed_kmh, active } = req.body;
  await query(
    `UPDATE vehicles SET
      name = COALESCE($1, name),
      payload_limit_rand = $2,
      fuel_consumption_l_per_100km = COALESCE($3, fuel_consumption_l_per_100km),
      avg_speed_kmh = COALESCE($4, avg_speed_kmh),
      active = COALESCE($5, active)
    WHERE id = $6`,
    [name ?? null, payload_limit_rand ?? null, fuel_consumption_l_per_100km ?? null, avg_speed_kmh ?? null, active ?? null, req.params.id]
  );
  res.json(await queryOne('SELECT * FROM vehicles WHERE id = $1', [req.params.id]));
});

// Body: { name, vehicle_type, fuel_type, payload_limit_rand (null = unlimited),
//         crew_driver, crew_helpers, fuel_consumption_l_per_100km, avg_speed_kmh }
// New vehicles start with an estimated consumption/speed — the same
// self-learning rolling-average logic refines these once the vehicle has
// real fill-ups and trips logged, exactly like the original three.
vehiclesRouter.post('/', async (req, res) => {
  const {
    name, vehicle_type, fuel_type, payload_limit_rand,
    crew_driver = 1, crew_helpers = 1,
    fuel_consumption_l_per_100km, avg_speed_kmh = 35,
  } = req.body;

  if (!name || !vehicle_type || !fuel_type || !fuel_consumption_l_per_100km) {
    return res.status(400).json({ error: 'name, vehicle_type, fuel_type and fuel_consumption_l_per_100km are required' });
  }

  const created = await queryOne(
    `INSERT INTO vehicles (name, vehicle_type, fuel_type, payload_limit_rand, crew_driver, crew_helpers, fuel_consumption_l_per_100km, avg_speed_kmh)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [name, vehicle_type, fuel_type, payload_limit_rand ?? null, crew_driver, crew_helpers, fuel_consumption_l_per_100km, avg_speed_kmh]
  );

  res.json(created);
});

// GET /api/vehicles/availability?date=YYYY-MM-DD
// Returns every active vehicle with its availability for that date
// (defaults to available if no override has been set).
vehiclesRouter.get('/availability', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date query param required' });

  const vehicles = await query('SELECT * FROM vehicles WHERE active = true');
  const overrides = await query('SELECT vehicle_id, available, reason FROM vehicle_availability WHERE date = $1', [date]);
  const overrideMap = Object.fromEntries(overrides.map((o) => [o.vehicle_id, o]));

  res.json(vehicles.map((v) => ({
    ...v,
    available: overrideMap[v.id] ? !!overrideMap[v.id].available : true,
    reason: overrideMap[v.id]?.reason || null,
  })));
});

// Body: { date, availability: [{ vehicle_id, available, reason? }] }
vehiclesRouter.post('/availability', async (req, res) => {
  const { date, availability } = req.body;
  if (!date || !Array.isArray(availability)) {
    return res.status(400).json({ error: 'Expected { date, availability: [{vehicle_id, available, reason}] }' });
  }

  for (const a of availability) {
    await query(
      `INSERT INTO vehicle_availability (vehicle_id, date, available, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (vehicle_id, date) DO UPDATE SET available = excluded.available, reason = excluded.reason`,
      [a.vehicle_id, date, a.available ? 1 : 0, a.reason || null]
    );
  }

  res.json({ ok: true });
});
