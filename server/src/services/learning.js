import { query, queryOne } from '../db/index.js';

// How much weight a single new observation gets against the existing
// estimate. Low value = smooth/gradual learning, resistant to one-off
// outliers (traffic jam, unusually chatty customer, etc.).
const LEARNING_RATE = 0.15;

function rollingAverage(previous, observed) {
  return previous + LEARNING_RATE * (observed - previous);
}

/**
 * Call this once a trip is marked complete (back_at_warehouse punched).
 * Recomputes vehicle average speed and per-customer dwell time from the
 * actual punch timestamps. Fuel consumption is learned separately, from
 * fill-up logs (see learnFromFuelLog below) — not from this trip.
 */
export async function learnFromCompletedTrip(tripId) {
  const trip = await queryOne('SELECT * FROM trips WHERE id = $1', [tripId]);
  if (!trip || !trip.left_warehouse_at || !trip.back_at_warehouse_at) return;

  const stops = await query('SELECT * FROM trip_stops WHERE trip_id = $1 ORDER BY seq ASC', [tripId]);
  const vehicle = await queryOne('SELECT * FROM vehicles WHERE id = $1', [trip.vehicle_id]);

  // --- Learn per-customer dwell time (arrived -> left at each stop) ---
  for (const stop of stops) {
    if (!stop.arrived_at || !stop.left_at) continue;
    const observedDwellMin = minutesBetween(stop.arrived_at, stop.left_at);
    const customer = await queryOne('SELECT avg_dwell_minutes FROM customers WHERE id = $1', [stop.customer_id]);
    const updated = rollingAverage(customer.avg_dwell_minutes, observedDwellMin);
    await query('UPDATE customers SET avg_dwell_minutes = $1 WHERE id = $2', [Math.max(2, updated), stop.customer_id]); // floor at 2 min, sanity guard
  }

  // --- Learn vehicle average speed from driving legs (excludes dwell time) ---
  let drivingMinutes = 0;
  let drivingKm = 0;
  let prevLeftTime = trip.left_warehouse_at;
  for (const stop of stops) {
    if (!stop.arrived_at || stop.leg_distance_km == null) continue;
    drivingMinutes += minutesBetween(prevLeftTime, stop.arrived_at);
    drivingKm += stop.leg_distance_km;
    prevLeftTime = stop.left_at || stop.arrived_at;
  }
  // final leg back to warehouse
  const lastStop = stops[stops.length - 1];
  if (lastStop && lastStop.left_at) {
    const finalLegMinutes = minutesBetween(lastStop.left_at, trip.back_at_warehouse_at);
    drivingMinutes += finalLegMinutes;
  }

  if (drivingMinutes > 0 && drivingKm > 0) {
    const observedSpeedKmh = drivingKm / (drivingMinutes / 60);
    const updatedSpeed = rollingAverage(vehicle.avg_speed_kmh, observedSpeedKmh);
    await query('UPDATE vehicles SET avg_speed_kmh = $1 WHERE id = $2', [clamp(updatedSpeed, 10, 80), vehicle.id]); // sanity bounds
  }
}

/**
 * Call this whenever a new fill-up is logged for a vehicle (odometer +
 * litres + Rand paid — exactly what's on the pump slip, nothing staff have
 * to estimate). Computes real consumption from the odometer distance since
 * the PREVIOUS fill-up and this fill-up's litres (standard "brim-to-brim"
 * fleet fuel tracking method), then rolls it into the vehicle's estimate.
 */
export async function learnFromFuelLog(fuelLogId) {
  const log = await queryOne('SELECT * FROM fuel_logs WHERE id = $1', [fuelLogId]);
  if (!log) return;

  const previous = await queryOne(`
    SELECT * FROM fuel_logs
    WHERE vehicle_id = $1 AND filled_at < $2 AND id != $3
    ORDER BY filled_at DESC LIMIT 1
  `, [log.vehicle_id, log.filled_at, log.id]);

  if (!previous) return; // first-ever fill-up for this vehicle — nothing to compare against yet

  const kmSinceLast = log.odometer_km - previous.odometer_km;

  // Sanity guard: reject an impossible or nonsensical interval (typo'd
  // odometer reading, e.g. digits transposed) rather than poisoning the
  // learned estimate with garbage.
  if (kmSinceLast <= 0 || kmSinceLast > 3000) {
    await query('UPDATE fuel_logs SET km_since_last = $1, l_per_100km_observed = NULL WHERE id = $2', [kmSinceLast, log.id]);
    return;
  }

  const observedLper100 = (log.litres / kmSinceLast) * 100;
  await query('UPDATE fuel_logs SET km_since_last = $1, l_per_100km_observed = $2 WHERE id = $3', [kmSinceLast, observedLper100, log.id]);

  const vehicle = await queryOne('SELECT fuel_consumption_l_per_100km FROM vehicles WHERE id = $1', [log.vehicle_id]);
  const updated = rollingAverage(vehicle.fuel_consumption_l_per_100km, observedLper100);
  await query('UPDATE vehicles SET fuel_consumption_l_per_100km = $1 WHERE id = $2', [clamp(updated, 3, 60), log.vehicle_id]);
}

function minutesBetween(isoA, isoB) {
  return (new Date(isoB) - new Date(isoA)) / 60000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
