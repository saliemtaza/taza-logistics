import { Router } from 'express';
import { query, queryOne, withTransaction } from '../db/index.js';
import { learnFromCompletedTrip } from '../services/learning.js';
import { generateDailyReport } from '../services/reports.js';

export const punchesRouter = Router();

// Every punch accepts a client-supplied ISO `timestamp`. Field devices
// capture the real moment locally (works offline) and this timestamp is
// trusted over server-receive-time, since a punch may be synced minutes or
// hours after it actually happened.
function nowOr(timestamp) {
  return timestamp || new Date().toISOString();
}

// Body: { trip_id, timestamp, driver_id, cash_collected_by, crew_ids? }
// driver_id and cash_collected_by are required — this is the "day picker"
// moment: the crew for this vehicle for the day is locked in right here,
// at the point the vehicle actually leaves. crew_ids is optional (vans
// often run with none/one, trucks up to three) and may repeat a person
// already used as driver/collector (e.g. driver doubling as collector).
punchesRouter.post('/left-warehouse', async (req, res) => {
  const { trip_id, timestamp, driver_id, cash_collected_by, crew_ids = [] } = req.body;
  if (!trip_id || !driver_id || !cash_collected_by) {
    return res.status(400).json({ error: 'trip_id, driver_id and cash_collected_by are required' });
  }

  await withTransaction(async (client) => {
    await client.query(
      "UPDATE trips SET left_warehouse_at = $1, status = 'in_progress', driver_id = $2, cash_collected_by = $3 WHERE id = $4",
      [nowOr(timestamp), driver_id, cash_collected_by, trip_id]
    );
    for (const staffId of crew_ids) {
      await client.query(
        'INSERT INTO trip_crew (trip_id, staff_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [trip_id, staffId]
      );
    }
  });

  res.json({ ok: true });
});

punchesRouter.post('/arrived', async (req, res) => {
  const { trip_stop_id, timestamp } = req.body;
  await query('UPDATE trip_stops SET arrived_at = $1 WHERE id = $2', [nowOr(timestamp), trip_stop_id]);
  res.json({ ok: true });
});

punchesRouter.post('/left-customer', async (req, res) => {
  const { trip_stop_id, timestamp } = req.body;
  await query('UPDATE trip_stops SET left_at = $1 WHERE id = $2', [nowOr(timestamp), trip_stop_id]);

  // Mark any order AND any collection tied to this stop as complete —
  // a stop can be a delivery, a collection, or both.
  await query("UPDATE orders SET status = 'delivered' WHERE trip_stop_id = $1", [trip_stop_id]);
  await query("UPDATE collections SET status = 'collected' WHERE trip_stop_id = $1", [trip_stop_id]);

  res.json({ ok: true });
});

punchesRouter.post('/back-at-warehouse', async (req, res) => {
  const { trip_id, timestamp } = req.body;

  await query(
    "UPDATE trips SET back_at_warehouse_at = $1, status = 'complete' WHERE id = $2",
    [nowOr(timestamp), trip_id]
  );

  // Feed today's actuals back into the learning model immediately.
  await learnFromCompletedTrip(trip_id);

  // Rebuild today's report so it reflects this trip's real numbers —
  // cheap (recomputes from this date's trips only) and safe to re-run as
  // more trips complete through the day.
  const trip = await queryOne('SELECT trip_date FROM trips WHERE id = $1', [trip_id]);
  if (trip) await generateDailyReport(trip.trip_date);

  res.json({ ok: true });
});
