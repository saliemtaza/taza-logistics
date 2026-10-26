import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { query, withTransaction } from '../db/index.js';

const upload = multer({ storage: multer.memoryStorage() });
export const collectionsRouter = Router();

collectionsRouter.get('/', async (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' });

  const collections = await query(`
    SELECT cl.*, c.name AS customer_name, c.address
    FROM collections cl JOIN customers c ON c.id = cl.customer_id
    WHERE cl.collection_date = $1
    ORDER BY cl.id
  `, [date]);
  res.json(collections);
});

// Body: { date: 'YYYY-MM-DD', collections: [{ customer_id, amount_due_rand? }] }
// The amount is optional and defaults to 0: a collection is on the list so
// the customer gets fitted into the route, and the Rand value plays no part
// in routing (it never counts toward a vehicle's payload cap).
collectionsRouter.post('/', async (req, res) => {
  const { date, collections } = req.body;
  if (!date || !Array.isArray(collections)) {
    return res.status(400).json({ error: 'Expected { date, collections: [{customer_id, amount_due_rand}] }' });
  }

  await withTransaction(async (client) => {
    // Clear everything not yet actually collected — a 'planned' row (one
    // already included in a generated route) must be replaced too, or it
    // survives alongside the newly-saved list and gets double-counted the
    // next time a route is generated.
    await client.query("DELETE FROM collections WHERE collection_date = $1 AND status != 'collected'", [date]);
    for (const c of collections) {
      const amount = Number(c.amount_due_rand);
      await client.query('INSERT INTO collections (customer_id, collection_date, amount_due_rand) VALUES ($1, $2, $3)', [c.customer_id, date, Number.isFinite(amount) ? amount : 0]);
    }
  });

  res.json({ ok: true, count: collections.length });
});

// CSV upload: columns `code` or `name` (matched against the customer
// database, same as customer sync). An `amount_due_rand` column is optional
// and ignored if absent (stored as 0). Form field `date` required alongside
// the file.
collectionsRouter.post('/upload', upload.single('file'), async (req, res) => {
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
    await client.query("DELETE FROM collections WHERE collection_date = $1 AND status != 'collected'", [date]);
    for (const row of records) {
      const code = row.code || row.Code || null;
      const name = row.name || row.Name || row['Customer Name'];
      // Rows are kept even with no amount — the amount is optional now.
      // Rows with neither a code nor a name (blank/totals lines) are skipped.
      if (!code && !String(name ?? '').trim()) continue;
      const parsedAmount = parseFloat(String(row.amount_due_rand ?? row.amount ?? row.Amount ?? '').replace(/[R,\s"]/g, ''));
      const amount = Number.isFinite(parsedAmount) ? parsedAmount : 0;

      const customerResult = code
        ? await client.query('SELECT id FROM customers WHERE code = $1', [code])
        : await client.query('SELECT id FROM customers WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))', [name]);
      const customer = customerResult.rows[0];
      if (!customer) { notFound.push(code || name); continue; }

      await client.query('INSERT INTO collections (customer_id, collection_date, amount_due_rand) VALUES ($1, $2, $3)', [customer.id, date, amount]);
      inserted += 1;
    }
  });

  res.json({ inserted, notFound });
});
