import { Router } from 'express';
import { query, queryOne } from '../db/index.js';

export const dashboardRouter = Router();

const TZ = 'Africa/Johannesburg';
const BACK_BY_MIN = 16 * 60 + 30; // every vehicle should be back by 16:30
const DEFAULT_WARN_KM = 1000;

const num = (x) => (x == null || x === '' ? 0 : Number(x));
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// The server runs in UTC; all "today" and "back by 16:30" logic is South African time.
function todaySast() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}
function minutesOfDaySast(iso) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === 'hour').value) % 24;
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}
const round1 = (x) => Math.round(x * 10) / 10;

function emptyAgg() {
  return {
    // calculated — from the route plans
    trips: 0, stops: 0, deliveryValue: 0, km: 0, minutesOnRoad: 0, fuelLitres: 0, fuelCost: 0,
    // actual — from field punches (completed trips only)
    tripsDone: 0, stopsDone: 0, deliveredValue: 0, actualMinutes: 0, plannedMinutesDone: 0, lateBack: 0,
    // actual — from fuel fill-ups (odometer based)
    fills: 0, fillKm: 0, fillLitres: 0, fillCost: 0, fillLitresWithKm: 0,
  };
}

// GET /api/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD
dashboardRouter.get('/', async (req, res) => {
  const today = todaySast();
  let { from, to } = req.query;
  if (!isDate(to)) to = today;
  if (!isDate(from)) from = `${to.slice(0, 8)}01`;
  if (from > to) [from, to] = [to, from];
  if ((new Date(to) - new Date(from)) / 86400000 > 400) {
    return res.status(400).json({ error: 'Choose a range of 13 months or less.' });
  }

  const [vehicles, trips, fuel, lastServices, calcSince, odometers, pace] = await Promise.all([
    query(`SELECT id, name, vehicle_type, fuel_type, active, maintenance_cost_per_km, fuel_consumption_l_per_100km,
                  avg_loading_minutes, service_interval_km, service_warn_km
           FROM vehicles ORDER BY active DESC, name`),
    query(`
      SELECT t.id, t.trip_date, t.vehicle_id, t.planned_distance_km, t.planned_duration_min,
             t.planned_fuel_litres, t.planned_fuel_cost_rand, t.left_warehouse_at, t.back_at_warehouse_at,
             COUNT(s.id) AS stops,
             COUNT(s.id) FILTER (WHERE s.left_at IS NOT NULL) AS stops_done,
             COALESCE(SUM(s.delivery_value_rand), 0) AS delivery_value,
             COALESCE(SUM(s.delivery_value_rand) FILTER (WHERE s.left_at IS NOT NULL), 0) AS delivered_value
      FROM trips t LEFT JOIN trip_stops s ON s.trip_id = t.id
      WHERE t.trip_date BETWEEN $1 AND $2
      GROUP BY t.id`, [from, to]),
    query(`
      SELECT vehicle_id, COUNT(*) AS fills,
             COALESCE(SUM(km_since_last), 0) AS km,
             COALESCE(SUM(litres), 0) AS litres,
             COALESCE(SUM(litres) FILTER (WHERE km_since_last IS NOT NULL), 0) AS litres_with_km,
             COALESCE(SUM(cost_rand), 0) AS cost
      FROM fuel_logs
      WHERE (filled_at AT TIME ZONE '${TZ}')::date BETWEEN $1 AND $2
      GROUP BY vehicle_id`, [from, to]),
    query(`SELECT DISTINCT ON (vehicle_id) id, vehicle_id, serviced_on, odometer_km, cost_rand, notes
           FROM vehicle_services ORDER BY vehicle_id, serviced_on DESC, id DESC`),
    query(`
      SELECT t.vehicle_id, SUM(t.planned_distance_km) AS km
      FROM trips t
      JOIN (SELECT DISTINCT ON (vehicle_id) vehicle_id, serviced_on FROM vehicle_services
            ORDER BY vehicle_id, serviced_on DESC, id DESC) ls ON ls.vehicle_id = t.vehicle_id
      WHERE t.trip_date > ls.serviced_on AND t.trip_date <= $1::date
      GROUP BY t.vehicle_id`, [today]),
    query(`SELECT DISTINCT ON (vehicle_id) vehicle_id, odometer_km, filled_at
           FROM fuel_logs WHERE odometer_km IS NOT NULL ORDER BY vehicle_id, filled_at DESC`),
    query(`
      SELECT vehicle_id, SUM(planned_distance_km) / NULLIF(COUNT(DISTINCT trip_date), 0) AS km_per_day
      FROM trips WHERE trip_date > ($1::date - 60) AND trip_date <= $1::date
      GROUP BY vehicle_id`, [today]),
  ]);

  const key = (id) => String(id);
  const aggs = new Map(vehicles.map((v) => [key(v.id), emptyAgg()]));
  const vById = new Map(vehicles.map((v) => [key(v.id), v]));

  for (const t of trips) {
    const a = aggs.get(key(t.vehicle_id));
    if (!a) continue;
    const v = vById.get(key(t.vehicle_id));
    const deliveryValue = num(t.delivery_value);
    const plannedMin = num(t.planned_duration_min);
    // Planned duration includes warehouse loading; the field punches only time left -> back,
    // so compare like with like by taking loading out of the planned figure.
    const onRoadMin = Math.max(0, plannedMin - (deliveryValue > 0 ? num(v.avg_loading_minutes) : 0));
    a.trips += 1;
    a.stops += num(t.stops);
    a.deliveryValue += deliveryValue;
    a.km += num(t.planned_distance_km);
    a.minutesOnRoad += onRoadMin;
    a.fuelLitres += num(t.planned_fuel_litres);
    a.fuelCost += num(t.planned_fuel_cost_rand);
    a.stopsDone += num(t.stops_done);
    a.deliveredValue += num(t.delivered_value);
    if (t.left_warehouse_at && t.back_at_warehouse_at) {
      a.tripsDone += 1;
      a.actualMinutes += (new Date(t.back_at_warehouse_at) - new Date(t.left_warehouse_at)) / 60000;
      a.plannedMinutesDone += onRoadMin;
      if (minutesOfDaySast(t.back_at_warehouse_at) > BACK_BY_MIN) a.lateBack += 1;
    }
  }
  for (const f of fuel) {
    const a = aggs.get(key(f.vehicle_id));
    if (!a) continue;
    a.fills = num(f.fills); a.fillKm = num(f.km); a.fillLitres = num(f.litres);
    a.fillLitresWithKm = num(f.litres_with_km); a.fillCost = num(f.cost);
  }

  const shape = (v, a) => {
    const mpk = num(v.maintenance_cost_per_km);
    const calcMaint = a.km * mpk;
    const calcRunning = a.fuelCost + calcMaint;
    const haveFuel = a.fills > 0;
    const actualMaint = haveFuel ? a.fillKm * mpk : null;
    const actualRunning = haveFuel ? a.fillCost + actualMaint : null;
    return {
      calculated: {
        trips: a.trips, stops: a.stops, deliveryValue: Math.round(a.deliveryValue),
        km: round1(a.km), hoursOnRoad: round1(a.minutesOnRoad / 60),
        fuelLitres: round1(a.fuelLitres), fuelCost: Math.round(a.fuelCost),
        maintenanceCost: Math.round(calcMaint), runningCost: Math.round(calcRunning),
        costPerKm: a.km > 0 ? Math.round((calcRunning / a.km) * 100) / 100 : null,
        costPerStop: a.stops > 0 ? Math.round(calcRunning / a.stops) : null,
        litresPer100km: v.fuel_consumption_l_per_100km != null ? round1(num(v.fuel_consumption_l_per_100km)) : null,
      },
      actual: {
        tripsCompleted: a.tripsDone, stopsCompleted: a.stopsDone, deliveredValue: Math.round(a.deliveredValue),
        hoursOnRoad: a.tripsDone > 0 ? round1(a.actualMinutes / 60) : null,
        plannedHoursSameTrips: a.tripsDone > 0 ? round1(a.plannedMinutesDone / 60) : null,
        backLateCount: a.lateBack,
        // from fuel fill-ups (odometer readings)
        fuelFills: a.fills,
        km: haveFuel && a.fillKm > 0 ? round1(a.fillKm) : null,
        fuelLitres: haveFuel ? round1(a.fillLitres) : null,
        fuelCost: haveFuel ? Math.round(a.fillCost) : null,
        maintenanceCost: actualMaint != null ? Math.round(actualMaint) : null,
        runningCost: actualRunning != null ? Math.round(actualRunning) : null,
        costPerKm: haveFuel && a.fillKm > 0 ? Math.round((actualRunning / a.fillKm) * 100) / 100 : null,
        costPerStop: haveFuel && a.stopsDone > 0 ? Math.round(actualRunning / a.stopsDone) : null,
        litresPer100km: a.fillKm > 0 ? round1((a.fillLitresWithKm / a.fillKm) * 100) : null,
      },
    };
  };

  const vehicleRows = vehicles
    .filter((v) => v.active || aggs.get(key(v.id)).trips > 0)
    .map((v) => ({ id: v.id, name: v.name, vehicle_type: v.vehicle_type, ...shape(v, aggs.get(key(v.id))) }));

  // Fleet totals: same maths, summed over every vehicle's raw figures.
  const total = emptyAgg();
  for (const a of aggs.values()) for (const k of Object.keys(total)) total[k] += a[k];
  const fleetMaint = vehicles.reduce((s, v) => s + aggs.get(key(v.id)).km * num(v.maintenance_cost_per_km), 0);
  const fleetActualMaint = vehicles.reduce((s, v) => {
    const a = aggs.get(key(v.id));
    return s + (a.fills > 0 ? a.fillKm * num(v.maintenance_cost_per_km) : 0);
  }, 0);
  const fleetHaveFuel = total.fills > 0;
  const calcRunningAll = total.fuelCost + fleetMaint;
  const actualRunningAll = fleetHaveFuel ? total.fillCost + fleetActualMaint : null;
  const totals = {
    calculated: {
      trips: total.trips, stops: total.stops, deliveryValue: Math.round(total.deliveryValue), km: round1(total.km),
      hoursOnRoad: round1(total.minutesOnRoad / 60), fuelLitres: round1(total.fuelLitres), fuelCost: Math.round(total.fuelCost),
      maintenanceCost: Math.round(fleetMaint), runningCost: Math.round(calcRunningAll),
      costPerKm: total.km > 0 ? Math.round((calcRunningAll / total.km) * 100) / 100 : null,
      costPerStop: total.stops > 0 ? Math.round(calcRunningAll / total.stops) : null,
      litresPer100km: null,
    },
    actual: {
      tripsCompleted: total.tripsDone, stopsCompleted: total.stopsDone, deliveredValue: Math.round(total.deliveredValue),
      hoursOnRoad: total.tripsDone > 0 ? round1(total.actualMinutes / 60) : null,
      plannedHoursSameTrips: total.tripsDone > 0 ? round1(total.plannedMinutesDone / 60) : null,
      backLateCount: total.lateBack, fuelFills: total.fills,
      km: fleetHaveFuel && total.fillKm > 0 ? round1(total.fillKm) : null,
      fuelLitres: fleetHaveFuel ? round1(total.fillLitres) : null,
      fuelCost: fleetHaveFuel ? Math.round(total.fillCost) : null,
      maintenanceCost: fleetHaveFuel ? Math.round(fleetActualMaint) : null,
      runningCost: actualRunningAll != null ? Math.round(actualRunningAll) : null,
      costPerKm: fleetHaveFuel && total.fillKm > 0 ? Math.round((actualRunningAll / total.fillKm) * 100) / 100 : null,
      costPerStop: fleetHaveFuel && total.stopsDone > 0 ? Math.round(actualRunningAll / total.stopsDone) : null,
      litresPer100km: total.fillKm > 0 ? round1((total.fillLitresWithKm / total.fillKm) * 100) : null,
    },
  };

  // ---- Service tracker (always "up to today", independent of the date range) ----
  const lastBy = new Map(lastServices.map((r) => [key(r.vehicle_id), r]));
  const calcBy = new Map(calcSince.map((r) => [key(r.vehicle_id), num(r.km)]));
  const odoBy = new Map(odometers.map((r) => [key(r.vehicle_id), r]));
  const paceBy = new Map(pace.map((r) => [key(r.vehicle_id), num(r.km_per_day)]));

  const service = vehicles.filter((v) => v.active).map((v) => {
    const k = key(v.id);
    const last = lastBy.get(k) || null;
    const interval = v.service_interval_km != null ? num(v.service_interval_km) : null;
    const warnKm = v.service_warn_km != null ? num(v.service_warn_km) : DEFAULT_WARN_KM;
    const odo = odoBy.get(k) || null;
    const calcKm = last ? round1(calcBy.get(k) || 0) : null;
    const odoKm = last && last.odometer_km != null && odo ? Math.max(0, round1(num(odo.odometer_km) - num(last.odometer_km))) : null;
    const usedKm = last ? (odoKm != null ? odoKm : calcKm) : null;
    const kmPerDay = paceBy.get(k) || 0;
    let state = 'ok';
    let remaining = null;
    if (!last) state = 'no_baseline';
    else if (interval == null) state = 'no_interval';
    else {
      remaining = round1(interval - usedKm);
      state = remaining < 0 ? 'overdue' : remaining <= warnKm ? 'due_soon' : 'ok';
    }
    return {
      vehicle_id: v.id, name: v.name, state,
      intervalKm: interval, warnKm,
      lastServiceOn: last ? last.serviced_on : null,
      lastServiceOdometer: last && last.odometer_km != null ? num(last.odometer_km) : null,
      calculatedKmSince: calcKm,
      odometerKmSince: odoKm,
      odometerAsOf: odo ? odo.filled_at : null,
      basis: odoKm != null ? 'odometer' : 'calculated',
      usedKm, remainingKm: remaining,
      kmPerWorkingDay: kmPerDay > 0 ? round1(kmPerDay) : null,
      workingDaysLeft: remaining != null && kmPerDay > 0 ? Math.max(0, Math.floor(remaining / kmPerDay)) : null,
    };
  });

  res.json({ from, to, today, backBy: '16:30', generatedAt: new Date().toISOString(), totals, vehicles: vehicleRows, service });
});

// POST /api/dashboard/service  { vehicle_id, serviced_on, odometer_km?, cost_rand?, notes? }
dashboardRouter.post('/service', async (req, res) => {
  const { vehicle_id, serviced_on, odometer_km, cost_rand, notes } = req.body || {};
  if (!vehicle_id || !isDate(serviced_on)) {
    return res.status(400).json({ error: 'vehicle_id and serviced_on (YYYY-MM-DD) are required.' });
  }
  const vehicle = await queryOne('SELECT id FROM vehicles WHERE id = $1', [vehicle_id]);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found.' });
  const odo = odometer_km === '' || odometer_km == null ? null : Number(odometer_km);
  const cost = cost_rand === '' || cost_rand == null ? null : Number(cost_rand);
  if ((odo != null && !Number.isFinite(odo)) || (cost != null && !Number.isFinite(cost))) {
    return res.status(400).json({ error: 'Odometer and cost must be numbers.' });
  }
  const rows = await query(
    `INSERT INTO vehicle_services (vehicle_id, serviced_on, odometer_km, cost_rand, notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [vehicle_id, serviced_on, odo, cost, notes ? String(notes).slice(0, 500) : null]
  );
  res.json({ ok: true, id: rows[0].id });
});

// POST /api/dashboard/service-settings/:vehicleId  { service_interval_km, service_warn_km }
dashboardRouter.post('/service-settings/:vehicleId', async (req, res) => {
  const interval = req.body?.service_interval_km;
  const warn = req.body?.service_warn_km;
  const iv = interval === '' || interval == null ? null : Number(interval);
  const wv = warn === '' || warn == null ? DEFAULT_WARN_KM : Number(warn);
  if ((iv != null && (!Number.isFinite(iv) || iv <= 0)) || !Number.isFinite(wv) || wv < 0) {
    return res.status(400).json({ error: 'Interval must be a positive number of km; warning distance must be 0 or more.' });
  }
  await query('UPDATE vehicles SET service_interval_km = $1, service_warn_km = $2 WHERE id = $3', [iv, wv, req.params.vehicleId]);
  res.json({ ok: true });
});
