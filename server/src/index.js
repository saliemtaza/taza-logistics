import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import './db/index.js'; // side-effect import: sets up the DB connection (and, for local SQLite, creates/seeds the file) as soon as the module loads
import { customersRouter } from './routes/customers.js';
import { vehiclesRouter } from './routes/vehicles.js';
import { ordersRouter } from './routes/orders.js';
import { collectionsRouter } from './routes/collections.js';
import { planningRouter } from './routes/planning.js';
import { punchesRouter } from './routes/punches.js';
import { loadingRouter } from './routes/loading.js';
import { settingsRouter } from './routes/settings.js';
import { fuelLogsRouter } from './routes/fuelLogs.js';
import { archiveRouter } from './routes/archive.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/customers', customersRouter);
app.use('/api/vehicles', vehiclesRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/collections', collectionsRouter);
app.use('/api/planning', planningRouter);
app.use('/api/punches', punchesRouter);
app.use('/api/loading', loadingRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/fuel-logs', fuelLogsRouter);
app.use('/api/archive', archiveRouter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 4000;
// Bind to all interfaces so phones/tablets on the same warehouse WiFi can
// reach this server at http://<this-machine's-LAN-IP>:4000 — this is what
// makes multi-device punching work in the local-first phase, before Supabase.
app.listen(port, '0.0.0.0', () => {
  console.log(`Taza Logistics server running on http://0.0.0.0:${port}`);
});
