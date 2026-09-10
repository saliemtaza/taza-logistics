import { Router } from 'express';
import { query, withTransaction } from '../db/index.js';
import { planRoutes } from '../services/optimizer.js';
import { getRoadRoute } from '../services/geocode.js';

export const planningRouter = Router();

async function loadSettings() {
  const rows = await query('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

async function loadFuelPrices() {
  const rows = await query(`
    SELECT fuel_type, price_per_litre FROM fuel_prices
    WHERE (fuel_type, effective_date) IN (
      SELECT fuel_type, MAX(effective_date) FROM fuel_prices GROUP BY fuel_type
    )
  `);
  return Object.fromEntries(rows.map((r) => [r.fuel_type, r.price_per_litre]));
}

planningRouter.get('/:date', async (req, res) => {
  const trips = await query('SELECT * FROM trips WHERE trip_date = $1', [req.params.date]);
  const full = await Promise.all(trips.map(async (trip) => ({
    ...trip,
    stops: await query(`
      SELECT ts.*, c.name AS customer_name, c.address
      FROM trip_stops ts JOIN customers c ON c.id = ts.customer_id
      WHERE ts.trip_id = $1 ORDER BY ts.seq
    `, [trip.id]),
  })));
  res.json(full);
});

// Body: { date: 'YYYY-MM-DD', useRoadRouting: boolean }
planningRouter.post('/generate', async (req, res) => {
  const { date, useRoadRouting = true } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });

  const settings = await loadSettings();
  if (!settings.warehouse_lat || !settings.warehouse_lng) {
    return res.status(400).json({ error: 'Warehouse address is not set/geocoded yet — set it under Settings first.' });
  }
  const warehouse = { lat: parseFloat(settings.warehouse_lat), lng: parseFloat(settings.warehouse_lng) };

  // Include both 'pending' and previously-'planned' rows (never 'delivered'/
  // 'collected'/'cancelled') so re-generating a plan for a day that was
  // already planned re-includes everything still outstanding.
  const orderRows = await query(`
    SELECT o.id AS order_id, o.customer_id, o.value_rand, c.name, c.address, c.lat, c.lng, c.avg_dwell_minutes
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.order_date = $1 AND o.status IN ('pending', 'planned')
  `, [date]);
  const collectionRows = await query(`
    SELECT cl.id AS collection_id, cl.customer_id, cl.amount_due_rand, c.name, c.address, c.lat, c.lng, c.avg_dwell_minutes
    FROM collections cl JOIN customers c ON c.id = cl.customer_id
    WHERE cl.collection_date = $1 AND cl.status IN ('pending', 'planned')
  `, [date]);

  if (orderRows.length === 0 && collectionRows.length === 0) {
    return res.status(400).json({ error: `No orders or collections found for ${date}. Add today's orders (and any collections) first.` });
  }

  // Merge deliveries and collections by customer into one stop per customer
  // — a customer needing both gets visited once, not twice. Only the
  // delivery value counts toward a van's Rand payload cap; the collection
  // amount rides along for display/routing only.
  const stopMap = new Map();
  function getOrCreateStop(row) {
    let stop = stopMap.get(row.customer_id);
    if (!stop) {
      stop = {
        customer_id: row.customer_id, name: row.name, address: row.address,
        lat: row.lat, lng: row.lng, avg_dwell_minutes: row.avg_dwell_minutes,
        value_rand: 0, collection_amount_rand: 0, order_ids: [], collection_ids: [],
      };
      stopMap.set(row.customer_id, stop);
    }
    return stop;
  }
  for (const o of orderRows) {
    const stop = getOrCreateStop(o);
    stop.value_rand += parseFloat(o.value_rand);
    stop.order_ids.push(o.order_id);
  }
  for (const c of collectionRows) {
    const stop = getOrCreateStop(c);
    stop.collection_amount_rand += parseFloat(c.amount_due_rand);
    stop.collection_ids.push(c.collection_id);
  }
  const stops = [...stopMap.values()];

  const ungeocoded = stops.filter((s) => s.lat == null || s.lng == null);
  if (ungeocoded.length > 0) {
    return res.status(400).json({
      error: 'Some customers on today\u2019s list have not been geocoded yet.',
      customers: ungeocoded.map((s) => ({ customer_id: s.customer_id, name: s.name, address: s.address })),
    });
  }

  // Vehicle availability: active vehicles minus any marked unavailable for
  // this specific date (breakdown, driver off, etc.).
  const availabilityOverrides = await query(
    'SELECT vehicle_id, available FROM vehicle_availability WHERE date = $1', [date]
  );
  const unavailableIds = new Set(availabilityOverrides.filter((o) => !o.available).map((o) => o.vehicle_id));
  const allActiveVehicles = await query('SELECT * FROM vehicles WHERE active = true');
  const vehicles = allActiveVehicles.filter((v) => !unavailableIds.has(v.id));

  if (vehicles.length === 0) {
    return res.status(400).json({ error: `No vehicles are marked available for ${date} — check Vehicle Availability on the Route Plan page.` });
  }

  const fuelPrices = await loadFuelPrices();

  const { plan, overflow, windowMinutes } = planRoutes({
    orders: stops,
    vehicles,
    warehouse,
    openTime: settings.open_time || '08:00',
    closeTime: settings.close_time || '16:30',
    warehouseLoadMinutes: parseFloat(settings.warehouse_load_minutes || '20'),
    fuelPrices,
  });

  // Optionally refine each route's distance/duration with real road data.
  // Best-effort: if the Google API isn't configured or a call fails, we
  // keep the straight-line estimate and flag it rather than failing the
  // whole plan.
  const refinementWarnings = [];
  if (useRoadRouting) {
    for (const route of plan) {
      if (route.stops.length === 0) continue;
      try {
        const points = [warehouse, ...route.stops.map((s) => ({ lat: s.lat, lng: s.lng })), warehouse];
        const road = await getRoadRoute(points);
        route.totalDistanceKm = road.totalDistanceKm;
        route.legDistancesKm = road.legs.map((l) => l.distanceKm);
        const driveMinutes = road.totalDurationMin;
        const dwellTotal = route.stops.reduce((s, c) => s + (c.avg_dwell_minutes ?? 10), 0);
        route.totalDurationMin = parseFloat(settings.warehouse_load_minutes || '20') + driveMinutes + dwellTotal;
        route.fitsWindow = route.totalDurationMin <= windowMinutes;
        const fuelPrice = fuelPrices[route.vehicle.fuel_type];
        route.fuelLitres = (route.totalDistanceKm / 100) * route.vehicle.fuel_consumption_l_per_100km;
        route.fuelCost = fuelPrice ? route.fuelLitres * fuelPrice : null;
      } catch (err) {
        refinementWarnings.push(`${route.vehicle.name}: kept straight-line estimate (${err.message})`);
      }
    }
  }

  // Persist: release any existing FK references first (orders/collections
  // .trip_stop_id would otherwise block deleting old trip_stops), wipe the
  // previous plan for the day, then insert the new one.
  await withTransaction(async (client) => {
    await client.query(
      "UPDATE orders SET status = 'pending', trip_stop_id = NULL WHERE order_date = $1 AND status != 'delivered'",
      [date]
    );
    await client.query(
      "UPDATE collections SET status = 'pending', trip_stop_id = NULL WHERE collection_date = $1 AND status != 'collected'",
      [date]
    );
    await client.query('DELETE FROM trip_stops WHERE trip_id IN (SELECT id FROM trips WHERE trip_date = $1)', [date]);
    await client.query('DELETE FROM trips WHERE trip_date = $1', [date]);

    for (const route of plan) {
      if (route.stops.length === 0) { route.trip_id = null; continue; }

      const tripResult = await client.query(
        `INSERT INTO trips (trip_date, vehicle_id, planned_distance_km, planned_duration_min, planned_fuel_litres, planned_fuel_cost_rand, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'planned') RETURNING id`,
        [date, route.vehicle.id, route.totalDistanceKm, route.totalDurationMin, route.fuelLitres, route.fuelCost]
      );
      route.trip_id = tripResult.rows[0].id;

      for (let i = 0; i < route.stops.length; i++) {
        const stop = route.stops[i];
        const legKm = route.legDistancesKm[i] ?? null;
        const stopResult = await client.query(
          `INSERT INTO trip_stops (trip_id, customer_id, seq, leg_distance_km, delivery_value_rand, collection_amount_rand)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [route.trip_id, stop.customer_id, i + 1, legKm, stop.value_rand || null, stop.collection_amount_rand || null]
        );
        const tripStopId = stopResult.rows[0].id;

        for (const orderId of stop.order_ids) {
          await client.query("UPDATE orders SET status = 'planned', trip_stop_id = $1 WHERE id = $2", [tripStopId, orderId]);
        }
        for (const collectionId of stop.collection_ids) {
          await client.query("UPDATE collections SET status = 'planned', trip_stop_id = $1 WHERE id = $2", [tripStopId, collectionId]);
        }
      }
    }
  });

  res.json({
    date,
    routes: plan,
    overflow: overflow.map((s) => ({
      customer_id: s.customer_id, name: s.name,
      value_rand: s.value_rand, collection_amount_rand: s.collection_amount_rand,
    })),
    warnings: refinementWarnings,
  });
});
