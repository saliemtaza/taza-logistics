import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { query, withTransaction } from '../db/index.js';

const upload = multer({ storage: multer.memoryStorage() });
export const ordersRouter = Router();

ordersRouter.get('/', async (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' });

  const orders = await query(`
    SELECT o.*, c.name AS customer_name, c.address, c.lat, c.lng, c.avg_dwell_minutes
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.order_date = $1
    ORDER BY o.id
  `, [date]);
  res.json(orders);
});

// Body: { date: 'YYYY-MM-DD', orders: [{ customer_id, value_rand }] }
// Replaces the day's order list wholesale — simplest safe behaviour for a
// daily planning workflow (avoids duplicate/partial entries on re-upload).
// Overwrites anything not yet actually delivered (matches the status
// convention planning.js already uses) — NOT just 'pending' rows, because
// once a route plan has been generated for the date, those same orders
// flip to 'planned', and a 'pending'-only filter would silently miss them
// on a re-save/re-upload and insert duplicates alongside them instead of
// replacing them.
ordersRouter.post('/', async (req, res) => {
  const { date, orders } = req.body;
  if (!date || !Array.isArray(orders)) {
    return res.status(400).json({ error: 'Expected { date, orders: [{customer_id, value_rand}] }' });
  }

  await withTransaction(async (client) => {
    await client.query("DELETE FROM orders WHERE order_date = $1 AND status != 'delivered'", [date]);
    for (const o of orders) {
      await client.query('INSERT INTO orders (customer_id, order_date, value_rand) VALUES ($1, $2, $3)', [o.customer_id, date, o.value_rand]);
    }
  });

  res.json({ ok: true, count: orders.length });
});

// CSV upload: columns `code` or `name` (matched against the customer
// database) and `value_rand`. Form field `date` required alongside the file.
// This is the automated alternative to manually ticking the order list —
// the result still shows up in the tick-box screen afterward for review.
ordersRouter.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'date form field required' });

  let records;
  try {
    records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    return res.status(400).json({ error: `Could not parse CSV: ${err.message}` });
  }

  let inserted = 0;
  const notFound = [];

  await withTransaction(async (client) => {
    await client.query("DELETE FROM orders WHERE order_date = $1 AND status != 'delivered'", [date]);
    for (const row of records) {
      const code = row.code || row.Code || null;
      const name = row.name || row.Name || row['Customer Name'];
      const rawValue = row.value_rand ?? row.value ?? row.Value ?? row.Balance;
      const value = parseFloat(String(rawValue ?? '').replace(/[R,\s"]/g, ''));
      if (!value) continue;

      const customerResult = code
        ? await client.query('SELECT id FROM customers WHERE code = $1', [code])
        : await client.query('SELECT id FROM customers WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))', [name]);
      const customer = customerResult.rows[0];
      if (!customer) { notFound.push(code || name); continue; }

      await client.query('INSERT INTO orders (customer_id, order_date, value_rand) VALUES ($1, $2, $3)', [customer.id, date, value]);
      inserted += 1;
    }
  });

  res.json({ inserted, notFound });
});
