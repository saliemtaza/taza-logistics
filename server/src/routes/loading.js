import { Router } from 'express';
import { query } from '../db/index.js';
import { learnFromLoadingTime } from '../services/learning.js';

export const loadingRouter = Router();

// 'HH:MM' minus a number of minutes -> 'HH:MM', wrapping into the previous
// day if it goes negative (shouldn't happen in practice, but avoids a
// garbage result if a route badly overruns the working day).
function subtractMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m - minutes;
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const mm = String(Math.round(wrapped % 60)).padStart(2, '0');
  return `${hh}:${mm}`;
}

// For a given date: every planned trip, its vehicle's learned loading time,
// and the "must start loading by" time worked backward from close_time —
// drive+dwell time, then loading time, off the end of the working day.
loadingRouter.get('/:date', async (req, res) => {
  const trips = await query(`
    SELECT t.*, v.name AS vehicle_name, v.avg_loading_minutes
    FROM trips t JOIN vehicles v ON v.id = t.vehicle_id
    WHERE t.trip_date = $1
  `, [req.params.date]);

  const settingsRows = await query('SELECT key, value FROM settings');
  const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
  const closeTime = settings.close_time || '16:30';
  // planned_duration_min now bakes in THIS vehicle's own avg_loading_minutes
  // directly (see optimizer.js) when the trip includes an actual delivery —
  // a pure cash-collection trip loads nothing onto the vehicle, so nothing
  // needs backing out or substituting for that kind of trip.

  const result = await Promise.all(trips.map(async (trip) => {
    const deliveryStop = await query(
      'SELECT 1 FROM trip_stops WHERE trip_id = $1 AND delivery_value_rand > 0 LIMIT 1',
      [trip.id]
    );
    const hasDeliveries = deliveryStop.length > 0;

    const driveDwellMinutes = hasDeliveries
      ? Math.max(0, (trip.planned_duration_min || 0) - trip.avg_loading_minutes)
      : (trip.planned_duration_min || 0);
    const loadMinutesToApply = hasDeliveries ? trip.avg_loading_minutes : 0;
    const mustStartLoadingBy = subtractMinutes(closeTime, driveDwellMinutes + loadMinutesToApply);

    return { ...trip, hasDeliveries, driveDwellMinutes, mustStartLoadingBy };
  }));

  // Soonest deadline first — surfaces whichever vehicle genuinely needs to
  // start loading next, rather than an arbitrary alphabetical order.
  result.sort((a, b) => a.mustStartLoadingBy.localeCompare(b.mustStartLoadingBy));

  res.json(result);
});

loadingRouter.post('/:tripId/start', async (req, res) => {
  await query('UPDATE trips SET load_started_at = $1 WHERE id = $2', [new Date().toISOString(), req.params.tripId]);
  res.json({ ok: true });
});

loadingRouter.post('/:tripId/end', async (req, res) => {
  await query('UPDATE trips SET load_ended_at = $1 WHERE id = $2', [new Date().toISOString(), req.params.tripId]);
  await learnFromLoadingTime(req.params.tripId);
  res.json({ ok: true });
});
