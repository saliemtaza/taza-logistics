import { Router } from 'express';
import { query } from '../db/index.js';
import { learnFromCompletedTrip } from '../services/learning.js';

export const punchesRouter = Router();

// Every punch accepts a client-supplied ISO `timestamp`. Field devices
// capture the real moment locally (works offline) and this timestamp is
// trusted over server-receive-time, since a punch may be synced minutes or
// hours after it actually happened.
function nowOr(timestamp) {
  return timestamp || new Date().toISOString();
}

punchesRouter.post('/left-warehouse', async (req, res) => {
  const { trip_id, timestamp } = req.body;
  await query(
    "UPDATE trips SET left_warehouse_at = $1, status = 'in_progress' WHERE id = $2",
    [nowOr(timestamp), trip_id]
  );
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

  res.json({ ok: true });
});
