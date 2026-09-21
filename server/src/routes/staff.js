import { Router } from 'express';
import { query, queryOne } from '../db/index.js';

export const staffRouter = Router();

staffRouter.get('/', async (req, res) => {
  res.json(await query('SELECT * FROM staff ORDER BY name'));
});

// Body: { name }
staffRouter.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const created = await queryOne(
    'INSERT INTO staff (name) VALUES ($1) RETURNING *',
    [name]
  );
  res.json(created);
});

// Body: { name?, active? } — deactivate instead of delete, so past trips
// (driver_id / cash_collected_by / trip_crew) keep a valid reference.
staffRouter.put('/:id', async (req, res) => {
  const { name, active } = req.body;
  await query(
    `UPDATE staff SET
      name = COALESCE($1, name),
      active = COALESCE($2, active)
    WHERE id = $3`,
    [name ?? null, active ?? null, req.params.id]
  );
  res.json(await queryOne('SELECT * FROM staff WHERE id = $1', [req.params.id]));
});
