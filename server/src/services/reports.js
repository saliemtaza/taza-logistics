import { Router } from 'express';
import { query, queryOne } from '../db/index.js';

export const reportsRouter = Router();

// List available report dates (most recent first) — just dates, not the
// full JSON blob each, so this stays cheap even with months of history.
reportsRouter.get('/', async (req, res) => {
  const rows = await query('SELECT report_date FROM daily_reports ORDER BY report_date DESC');
  res.json(rows.map((r) => r.report_date));
});

// GET /api/reports/:date — the full stored report for one day (includes
// driver/cash_collector/crew per vehicle, written by generateDailyReport).
reportsRouter.get('/:date', async (req, res) => {
  const row = await queryOne('SELECT data FROM daily_reports WHERE report_date = $1', [req.params.date]);
  if (!row) return res.status(404).json({ error: 'No report for that date' });
  res.json(row.data);
});
