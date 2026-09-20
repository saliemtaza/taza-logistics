import { Router } from 'express';
import { query, withTransaction } from '../db/index.js';
import { planRoutes, moveStop, moveOverflowStop, rankVehiclesByEfficiency, minutesBetween } from '../services/optimizer.js';
import { getRoadRoute } from '../services/geocode.js';
import { rollupOldMonths } from '../services/reports.js';

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
  const { date, useRoadRouting = true, reversed = false } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });

  // Opportunistic housekeeping: collapses any daily reports from before the
  // current month into permanent monthly summaries and clears the daily
  // rows, keeping storage bounded. Cheap no-op once nothing old remains.
  await rollupOldMonths().catch(() => {}); // best-effort — never block route generation on this

  const settings = await loadSettings();
  if (!settings.warehouse_lat || !settings.warehouse_lng) {
    return res.status(400).json({ error: 'Warehouse address is not set/geocoded yet — set it under Settings first.' });
  }
  const warehouse = { lat: parseFloat(settings.warehouse_lat), lng: parseFloat(settings.warehouse_lng) };

  // Trips that already have at least one completed (delivered/collected)
  // stop are frozen for the rest of the day: regenerating never touches
  // them, never reassigns their remaining stops elsewhere, and — see the
  // input queries right below — never pulls those remaining stops back
  // into the planner as if they were unassigned. Only trips with zero
  // progress get wiped and rebuilt below.
  const startedTripRows = await query(`
    SELECT DISTINCT t.id
    FROM trips t
    JOIN trip_stops ts ON ts.trip_id = t.id
    LEFT JOIN orders o ON o.trip_stop_id = ts.id
    LEFT JOIN collections cl ON cl.trip_stop_id = ts.id
    WHERE t.trip_date = $1 AND (o.status = 'delivered' OR cl.status = 'collected')
  `, [date]);
  const startedTripIds = startedTripRows.map((r) => r.id);

  // Include both 'pending' and previously-'planned' rows (never 'delivered'/
  // 'collected'/'cancelled') so re-generating a plan for a day that was
  // already planned re-includes everything still outstanding — EXCEPT rows
  // already attached to a frozen trip above, which stay exactly where they
  // are instead of also being handed to the planner as unassigned (that
  // double-counting is what caused today's order-count/allocation oddities).
  const orderRows = await query(`
    SELECT o.id AS order_id, o.customer_id, o.value_rand, c.name, c.address, c.lat, c.lng, c.avg_dwell_minutes
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.order_date = $1 AND o.status IN ('pending', 'planned')
    AND (o.trip_stop_id IS NULL OR o.trip_stop_id NOT IN (
      SELECT id FROM trip_stops WHERE trip_id = ANY($2::int[])
    ))
  `, [date, startedTripIds]);
  const collectionRows = await query(`
    SELECT cl.id AS collection_id, cl.customer_id, cl.amount_due_rand, c.name, c.address, c.lat, c.lng, c.avg_dwell_minutes
    FROM collections cl JOIN customers c ON c.id = cl.customer_id
    WHERE cl.collection_date = $1 AND cl.status IN ('pending', 'planned')
    AND (cl.trip_stop_id IS NULL OR cl.trip_stop_id NOT IN (
      SELECT id FROM trip_stops WHERE trip_id = ANY($2::int[])
    ))
  `, [date, startedTripIds]);

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
    fuelPrices,
    safetyMarginPct: parseFloat(settings.time_safety_margin_pct || '20'),
  });

  // Reverse stop order (A->B->C becomes C->B->A) — lets a day that gets cut
  // short before finishing hit different customers last each time, instead
  // of the same ones always being the ones left over. Distances are
  // symmetric (A->B same as B->A) so legDistancesKm simply reverses too;
  // if road routing is used below, it recomputes real per-leg distances
  // for this exact (already-reversed) stop order anyway.
  if (reversed) {
    for (const route of plan) {
      route.stops = [...route.stops].reverse();
      route.legDistancesKm = [...route.legDistancesKm].reverse();
    }
  }

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
        // Pure cash-collection stops load nothing onto the vehicle — only
        // charge warehouse loading time if this route has an actual delivery.
        const hasDeliveries = route.stops.some((c) => c.value_rand > 0);
        const loadMinutes = hasDeliveries ? route.vehicle.avg_loading_minutes : 0;
        route.totalDurationMin = loadMinutes + driveMinutes + dwellTotal;
        const safetyMarginPct = parseFloat(settings.time_safety_margin_pct || '20');
        route.fitsWindow = route.totalDurationMin * (1 + safetyMarginPct / 100) <= windowMinutes;
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
      `UPDATE orders SET status = 'pending', trip_stop_id = NULL
       WHERE order_date = $1 AND status != 'delivered'
       AND (trip_stop_id IS NULL OR trip_stop_id NOT IN (
         SELECT id FROM trip_stops WHERE trip_id = ANY($2::int[])
       ))`,
      [date, startedTripIds]
    );
    await client.query(
      `UPDATE collections SET status = 'pending', trip_stop_id = NULL
       WHERE collection_date = $1 AND status != 'collected'
       AND (trip_stop_id IS NULL OR trip_stop_id NOT IN (
         SELECT id FROM trip_stops WHERE trip_id = ANY($2::int[])
       ))`,
      [date, startedTripIds]
    );
    await client.query(
      'DELETE FROM trip_stops WHERE trip_id IN (SELECT id FROM trips WHERE trip_date = $1) AND trip_id != ALL($2::int[])',
      [date, startedTripIds]
    );
    await client.query(
      'DELETE FROM trips WHERE trip_date = $1 AND id != ALL($2::int[])',
      [date, startedTripIds]
    );

    for (const route of plan) {
      if (route.stops.length === 0) { route.trip_id = null; continue; }

      const tripResult = await client.query(
        `INSERT INTO trips (trip_date, vehicle_id, planned_distance_km, planned_duration_min, planned_fuel_litres, planned_fuel_cost_rand, reversed, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'planned') RETURNING id`,
        [date, route.vehicle.id, route.totalDistanceKm, route.totalDurationMin, route.fuelLitres, route.fuelCost, reversed]
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

  const rankedAllById = new Map(rankVehiclesByEfficiency(allActiveVehicles, fuelPrices).map((v) => [v.id, v]));
  const frozenRoutes = [];
  for (const tripId of startedTripIds) {
    const summary = await loadFrozenRouteSummary(tripId, rankedAllById);
    if (summary) {
      frozenRoutes.push(summary);
      refinementWarnings.push(`${summary.vehicle.name}: already out on this trip today (in progress) — left untouched, only the remaining pending orders were re-planned.`);
    }
  }

  res.json({
    date,
    routes: [...frozenRoutes, ...plan],
    overflow: overflow.map((s) => ({
      customer_id: s.customer_id, name: s.name,
      value_rand: s.value_rand, collection_amount_rand: s.collection_amount_rand,
    })),
    warnings: refinementWarnings,
  });
});

// Summarizes a frozen (already-started) trip straight from its stored
// planned figures rather than recomputing them — the trip wasn't touched
// by this regenerate, so what was already saved is still accurate. Shaped
// to match a normal `plan` route closely enough for RoutePlanPage to
// render it alongside freshly-planned ones.
async function loadFrozenRouteSummary(tripId, rankedById) {
  const tripRows = await query('SELECT * FROM trips WHERE id = $1', [tripId]);
  const trip = tripRows[0];
  if (!trip) return null;

  const stopRows = await query(`
    SELECT ts.customer_id, ts.leg_distance_km, ts.delivery_value_rand, ts.collection_amount_rand,
           c.name, c.address
    FROM trip_stops ts JOIN customers c ON c.id = ts.customer_id
    WHERE ts.trip_id = $1 ORDER BY ts.seq
  `, [tripId]);
  const stops = stopRows.map((r) => ({
    customer_id: r.customer_id, name: r.name, address: r.address,
    value_rand: parseFloat(r.delivery_value_rand || 0),
    collection_amount_rand: parseFloat(r.collection_amount_rand || 0),
  }));

  return {
    trip_id: trip.id,
    vehicle: rankedById.get(trip.vehicle_id),
    stops,
    legDistancesKm: stopRows.map((r) => (r.leg_distance_km != null ? parseFloat(r.leg_distance_km) : null)),
    totalDistanceKm: parseFloat(trip.planned_distance_km || 0),
    totalDurationMin: parseFloat(trip.planned_duration_min || 0),
    totalValueRand: stops.reduce((s, r) => s + r.value_rand, 0),
    fuelCost: trip.planned_fuel_cost_rand != null ? parseFloat(trip.planned_fuel_cost_rand) : null,
    fitsWindow: true,
    frozen: true,
  };
}

async function loadTripWithVehicleAndStops(tripId) {
  const tripRows = await query('SELECT * FROM trips WHERE id = $1', [tripId]);
  const trip = tripRows[0];
  if (!trip) return null;
  const vehicleRows = await query('SELECT * FROM vehicles WHERE id = $1', [trip.vehicle_id]);
  const vehicle = vehicleRows[0];
  const stopRows = await query(`
    SELECT ts.customer_id, ts.delivery_value_rand, ts.collection_amount_rand,
           c.name, c.address, c.lat, c.lng, c.avg_dwell_minutes
    FROM trip_stops ts JOIN customers c ON c.id = ts.customer_id
    WHERE ts.trip_id = $1 ORDER BY ts.seq
  `, [tripId]);
  const stops = stopRows.map((r) => ({
    customer_id: r.customer_id, name: r.name, address: r.address,
    lat: r.lat, lng: r.lng, avg_dwell_minutes: r.avg_dwell_minutes,
    value_rand: parseFloat(r.delivery_value_rand || 0),
    collection_amount_rand: parseFloat(r.collection_amount_rand || 0),
  }));
  return { trip_id: trip.id, trip_date: trip.trip_date, vehicle, stops };
}

// Loads one customer's still-unassigned order/collection data for a date —
// same aggregation as /generate's getOrCreateStop (a customer needing both
// gets merged into one stop), just scoped to a single customer instead of
// the whole day. Used when moving a stop off today's overflow list, since
// that stop was never attached to any trip and so isn't in trip_stops.
async function loadUnassignedStopForCustomer(date, customerId) {
  const orderRows = await query(`
    SELECT o.id AS order_id, o.value_rand, c.name, c.address, c.lat, c.lng, c.avg_dwell_minutes
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.order_date = $1 AND o.customer_id = $2 AND o.status = 'pending'
  `, [date, customerId]);
  const collectionRows = await query(`
    SELECT cl.id AS collection_id, cl.amount_due_rand, c.name, c.address, c.lat, c.lng, c.avg_dwell_minutes
    FROM collections cl JOIN customers c ON c.id = cl.customer_id
    WHERE cl.collection_date = $1 AND cl.customer_id = $2 AND cl.status = 'pending'
  `, [date, customerId]);
  if (orderRows.length === 0 && collectionRows.length === 0) return null;

  const base = orderRows[0] || collectionRows[0];
  const stop = {
    customer_id: customerId, name: base.name, address: base.address,
    lat: base.lat, lng: base.lng, avg_dwell_minutes: base.avg_dwell_minutes,
    value_rand: 0, collection_amount_rand: 0,
  };
  for (const o of orderRows) stop.value_rand += parseFloat(o.value_rand);
  for (const c of collectionRows) stop.collection_amount_rand += parseFloat(c.amount_due_rand);
  return stop;
}

// Body: { date, fromTripId (optional), toTripId, customerId }
// Moves one customer stop onto a vehicle's route, re-sequences the
// affected trip(s), and persists exactly like /generate persists a trip:
// release the old trip_stops' FK references, wipe them, reinsert in the
// new order, and re-point every affected order/collection at its new
// trip_stop row. With fromTripId, this is a move between two of today's
// trips (see moveStop in services/optimizer.js) and both are re-sequenced
// and persisted. Without fromTripId, the stop is coming off today's
// overflow (unassigned) list instead — it was never on any trip, so only
// the destination trip is touched (see moveOverflowStop).
planningRouter.post('/move-stop', async (req, res) => {
  const { date, fromTripId, toTripId, customerId } = req.body;
  if (!date || !toTripId || !customerId) {
    return res.status(400).json({ error: 'date, toTripId and customerId are required' });
  }

  const settings = await loadSettings();
  if (!settings.warehouse_lat || !settings.warehouse_lng) {
    return res.status(400).json({ error: 'Warehouse address is not set/geocoded yet — set it under Settings first.' });
  }
  const warehouse = { lat: parseFloat(settings.warehouse_lat), lng: parseFloat(settings.warehouse_lng) };
  const fuelPrices = await loadFuelPrices();
  const safetyMarginPct = parseFloat(settings.time_safety_margin_pct || '20');
  const windowMinutes = minutesBetween(settings.open_time || '08:00', settings.close_time || '16:30');

  // Re-attach today's efficiencyRank/costPerKm to each vehicle (computed
  // fresh at plan-generation time, not stored on the vehicle row) so the
  // returned route(s) still show correctly in the UI after the move,
  // rather than losing their "rank X of Y efficiency" label.
  const availabilityOverrides = await query(
    'SELECT vehicle_id, available FROM vehicle_availability WHERE date = $1', [date]
  );
  const unavailableIds = new Set(availabilityOverrides.filter((o) => !o.available).map((o) => o.vehicle_id));
  const allActiveVehicles = await query('SELECT * FROM vehicles WHERE active = true');
  const todaysVehicles = allActiveVehicles.filter((v) => !unavailableIds.has(v.id));
  const rankedById = new Map(rankVehiclesByEfficiency(todaysVehicles, fuelPrices).map((v) => [v.id, v]));

  const toRoute = await loadTripWithVehicleAndStops(toTripId);
  if (!toRoute) {
    return res.status(404).json({ error: 'That trip could not be found \u2014 the plan may have been regenerated since you loaded this page.' });
  }
  toRoute.vehicle = rankedById.get(toRoute.vehicle.id) || toRoute.vehicle;

  let updatedFromRoute = null;
  let updatedToRoute;
  let warning;
  let routesToPersist;

  if (fromTripId) {
    const fromRoute = await loadTripWithVehicleAndStops(fromTripId);
    if (!fromRoute) {
      return res.status(404).json({ error: 'One of those trips could not be found \u2014 the plan may have been regenerated since you loaded this page.' });
    }
    fromRoute.vehicle = rankedById.get(fromRoute.vehicle.id) || fromRoute.vehicle;

    const result = moveStop({ warehouse, fromRoute, toRoute, customerId, fuelPrices, safetyMarginPct, windowMinutes });
    updatedFromRoute = result.fromRoute;
    updatedToRoute = result.toRoute;
    warning = result.warning;
    routesToPersist = [updatedFromRoute, updatedToRoute];
  } else {
    const stop = await loadUnassignedStopForCustomer(date, customerId);
    if (!stop) {
      return res.status(404).json({ error: 'That order/collection could not be found among today\u2019s unassigned stops \u2014 it may have already been moved or the plan regenerated.' });
    }

    const result = moveOverflowStop({ warehouse, toRoute, stop, fuelPrices, safetyMarginPct, windowMinutes });
    updatedToRoute = result.toRoute;
    warning = result.warning;
    routesToPersist = [updatedToRoute];
  }

  await withTransaction(async (client) => {
    for (const route of routesToPersist) {
      await client.query(
        "UPDATE orders SET status = 'pending', trip_stop_id = NULL WHERE trip_stop_id IN (SELECT id FROM trip_stops WHERE trip_id = $1)",
        [route.trip_id]
      );
      await client.query(
        "UPDATE collections SET status = 'pending', trip_stop_id = NULL WHERE trip_stop_id IN (SELECT id FROM trip_stops WHERE trip_id = $1)",
        [route.trip_id]
      );
      await client.query('DELETE FROM trip_stops WHERE trip_id = $1', [route.trip_id]);

      await client.query(
        `UPDATE trips SET planned_distance_km = $2, planned_duration_min = $3, planned_fuel_litres = $4, planned_fuel_cost_rand = $5
         WHERE id = $1`,
        [route.trip_id, route.totalDistanceKm, route.totalDurationMin, route.fuelLitres, route.fuelCost]
      );

      for (let i = 0; i < route.stops.length; i++) {
        const stop = route.stops[i];
        const legKm = route.legDistancesKm[i] ?? null;
        const stopResult = await client.query(
          `INSERT INTO trip_stops (trip_id, customer_id, seq, leg_distance_km, delivery_value_rand, collection_amount_rand)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [route.trip_id, stop.customer_id, i + 1, legKm, stop.value_rand || null, stop.collection_amount_rand || null]
        );
        const tripStopId = stopResult.rows[0].id;

        await client.query(
          "UPDATE orders SET status = 'planned', trip_stop_id = $1 WHERE order_date = $2 AND customer_id = $3 AND status = 'pending'",
          [tripStopId, date, stop.customer_id]
        );
        await client.query(
          "UPDATE collections SET status = 'planned', trip_stop_id = $1 WHERE collection_date = $2 AND customer_id = $3 AND status = 'pending'",
          [tripStopId, date, stop.customer_id]
        );
      }
    }
  });

  res.json({ fromRoute: updatedFromRoute, toRoute: updatedToRoute, warning });
});
