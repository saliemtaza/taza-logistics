import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const SAST = 'Africa/Johannesburg';
const REFRESH_MS = 60000;

function sastToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SAST }).format(new Date());
}
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function monthStart(dateStr) { return `${dateStr.slice(0, 8)}01`; }
function weekStart(dateStr) { // Monday
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(dateStr, -((dow + 6) % 7));
}
function lastMonthRange(dateStr) {
  const firstThis = monthStart(dateStr);
  const lastPrev = addDays(firstThis, -1);
  return [monthStart(lastPrev), lastPrev];
}

const fmtNum = (n, dp = 0) => (n == null ? '—' : Number(n).toLocaleString('en-ZA', { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const fmtR = (n, dp = 0) => (n == null ? '—' : `R${fmtNum(n, dp)}`);
const fmtDate = (s) => (s ? String(s).slice(0, 10) : '—');
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-ZA', { timeZone: SAST, dateStyle: 'medium', timeStyle: 'short' }) : '—');

// Rows of the calculated-vs-actual table. `higherIsWorse` colours the variance.
const ROWS = [
  { label: 'Trips', calc: (c) => c.trips, act: (a) => a.tripsCompleted, fmt: (v) => fmtNum(v) },
  { label: 'Stops', calc: (c) => c.stops, act: (a) => a.stopsCompleted, fmt: (v) => fmtNum(v) },
  { label: 'Delivery value', calc: (c) => c.deliveryValue, act: (a) => a.deliveredValue, fmt: (v) => fmtR(v) },
  { label: 'Distance (km)', calc: (c) => c.km, act: (a) => a.km, fmt: (v) => fmtNum(v, 1), higherIsWorse: true, note: 'Actual = odometer, from fuel fill-ups' },
  { label: 'Time on the road (hrs)', calc: (c) => c.hoursOnRoad, act: (a) => a.hoursOnRoad, fmt: (v) => fmtNum(v, 1), higherIsWorse: true, varianceVs: (a) => a.plannedHoursSameTrips, note: 'Left warehouse → back; variance is against the plan for the completed trips only' },
  { label: 'Fuel (litres)', calc: (c) => c.fuelLitres, act: (a) => a.fuelLitres, fmt: (v) => fmtNum(v, 1), higherIsWorse: true },
  { label: 'Fuel cost', calc: (c) => c.fuelCost, act: (a) => a.fuelCost, fmt: (v) => fmtR(v), higherIsWorse: true },
  { label: 'Maintenance cost', calc: (c) => c.maintenanceCost, act: (a) => a.maintenanceCost, fmt: (v) => fmtR(v), higherIsWorse: true },
  { label: 'Total running cost', calc: (c) => c.runningCost, act: (a) => a.runningCost, fmt: (v) => fmtR(v), higherIsWorse: true, bold: true },
  { label: 'Cost per km', calc: (c) => c.costPerKm, act: (a) => a.costPerKm, fmt: (v) => fmtR(v, 2), higherIsWorse: true },
  { label: 'Cost per stop', calc: (c) => c.costPerStop, act: (a) => a.costPerStop, fmt: (v) => fmtR(v), higherIsWorse: true },
  { label: 'Fuel use (l/100 km)', calc: (c) => c.litresPer100km, act: (a) => a.litresPer100km, fmt: (v) => fmtNum(v, 1), higherIsWorse: true },
];

function variance(row, calcSide, actSide) {
  const actual = row.act(actSide);
  const base = row.varianceVs ? row.varianceVs(actSide) : row.calc(calcSide);
  if (actual == null || base == null) return { text: '—', color: undefined };
  const diff = actual - base;
  if (Math.abs(diff) < 1e-9) return { text: '0', color: undefined };
  const pct = base ? (diff / base) * 100 : null;
  const sign = diff > 0 ? '+' : '−';
  const text = `${sign}${row.fmt(Math.abs(diff)).replace('R', 'R')}${pct != null ? ` (${sign}${Math.abs(pct).toFixed(0)}%)` : ''}`;
  let color;
  if (row.higherIsWorse != null) color = (diff > 0) === row.higherIsWorse ? '#c0392b' : '#1a7f37';
  return { text, color };
}

const STATE_META = {
  ok: { label: 'OK', color: '#1a7f37' },
  due_soon: { label: 'Due soon', color: '#b7791f' },
  overdue: { label: 'OVERDUE', color: '#c0392b' },
  no_baseline: { label: 'No service recorded', color: '#666' },
  no_interval: { label: 'Set interval', color: '#666' },
};

function CompareTable({ calc, act, haveActualData }) {
  return (
    <table className="dash-table">
      <thead>
        <tr><th></th><th>Calculated</th><th>Actual</th><th>Variance</th></tr>
      </thead>
      <tbody>
        {ROWS.map((row) => {
          const c = row.calc(calc);
          const a = haveActualData(row) ? row.act(act) : null;
          const v = variance(row, calc, act);
          return (
            <tr key={row.label} style={row.bold ? { fontWeight: 600 } : undefined}>
              <td title={row.note}>{row.label}</td>
              <td>{c == null ? '—' : row.fmt(c)}</td>
              <td>{a == null ? '—' : row.fmt(a)}</td>
              <td style={{ color: v.color }}>{a == null ? '—' : v.text}</td>
            </tr>
          );
        })}
        <tr>
          <td>Trips back after 16:30</td>
          <td>—</td>
          <td>{act.tripsCompleted > 0 ? fmtNum(act.backLateCount) : '—'}</td>
          <td style={{ color: act.backLateCount > 0 ? '#c0392b' : undefined }}>{act.backLateCount > 0 ? '⚠ late' : ''}</td>
        </tr>
      </tbody>
    </table>
  );
}

// Field punches give trips, stops and times; km / litres / fuel cost only exist
// when fuel fill-ups were logged in the period. Rows that depend on data that
// isn't there yet show "—" instead of a misleading zero.
function actualAvailable(act) {
  const punched = act.tripsCompleted > 0 || act.stopsCompleted > 0;
  const fuelled = act.fuelFills > 0;
  return (row) => {
    switch (row.label) {
      case 'Trips': case 'Stops': case 'Delivery value': case 'Time on the road (hrs)': return punched;
      default: return fuelled;
    }
  };
}

export default function DashboardPage() {
  const [from, setFrom] = useState(() => monthStart(sastToday()));
  const [to, setTo] = useState(() => sastToday());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('all');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [serviceForm, setServiceForm] = useState(null);   // { vehicle_id, serviced_on, odometer_km, cost_rand, notes }
  const [settingsForm, setSettingsForm] = useState(null); // { vehicle_id, interval, warn }
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/api/dashboard?from=${from}&to=${to}`);
      setData(d);
      setError('');
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err.message || 'Could not load the dashboard.');
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  function preset(kind) {
    const today = sastToday();
    if (kind === 'today') { setFrom(today); setTo(today); }
    if (kind === 'week') { setFrom(weekStart(today)); setTo(today); }
    if (kind === 'month') { setFrom(monthStart(today)); setTo(today); }
    if (kind === 'lastmonth') { const [a, b] = lastMonthRange(today); setFrom(a); setTo(b); }
  }

  async function saveService() {
    try {
      await api.post('/api/dashboard/service', serviceForm);
      setServiceForm(null);
      setMessage('Service recorded.');
      load();
    } catch (err) { setMessage(`Could not save: ${err.message}`); }
  }
  async function saveSettings() {
    try {
      await api.post(`/api/dashboard/service-settings/${settingsForm.vehicle_id}`, {
        service_interval_km: settingsForm.interval, service_warn_km: settingsForm.warn,
      });
      setSettingsForm(null);
      setMessage('Service settings saved.');
      load();
    } catch (err) { setMessage(`Could not save: ${err.message}`); }
  }

  if (!data) {
    return <div className="page"><h2>Dashboard</h2>{error ? <p className="warn">{error}</p> : <p className="hint">Loading…</p>}</div>;
  }

  const rows = data.vehicles;
  const shown = selected === 'all' ? rows : rows.filter((v) => String(v.id) === selected);
  const view = selected === 'all' ? data.totals : (shown[0] || data.totals);
  const alerts = data.service.filter((s) => s.state === 'overdue' || s.state === 'due_soon');
  const tile = (label, value, sub) => (
    <div className="dash-tile"><div className="dash-tile-label">{label}</div><div className="dash-tile-value">{value}</div>{sub && <div className="dash-tile-sub">{sub}</div>}</div>
  );
  const vAct = view.actual;
  const punched = vAct.tripsCompleted > 0;

  return (
    <div className="page dash">
      <style>{`
        .dash-table { width: 100%; border-collapse: collapse; font-size: 0.92em; }
        .dash-table th, .dash-table td { padding: 5px 8px; border-bottom: 1px solid #ddd; text-align: right; }
        .dash-table th:first-child, .dash-table td:first-child { text-align: left; }
        .dash-tiles { display: flex; flex-wrap: wrap; gap: 10px; margin: 10px 0; }
        .dash-tile { flex: 1 1 150px; border: 1px solid #ddd; border-radius: 6px; padding: 8px 10px; }
        .dash-tile-label { font-size: 0.8em; color: #666; }
        .dash-tile-value { font-size: 1.3em; font-weight: 600; }
        .dash-tile-sub { font-size: 0.8em; color: #666; }
        .dash-alert { border-left: 5px solid; padding: 8px 12px; margin: 8px 0; border-radius: 4px; background: #fff; }
        .dash-print-head { display: none; }
        @media print {
          nav, header, .no-print { display: none !important; }
          .dash-print-head { display: block; margin-bottom: 8px; }
          .dash .card, .dash-alert, .dash-tile { break-inside: avoid; box-shadow: none; }
          body { background: #fff; }
        }
      `}</style>

      <div className="dash-print-head">
        <h2 style={{ margin: 0 }}>Taza Logistics — fleet dashboard</h2>
        <div>{fmtDate(data.from)} to {fmtDate(data.to)} · printed {fmtDateTime(new Date().toISOString())}</div>
      </div>

      <div className="no-print">
        <h2>Dashboard</h2>
        <div className="row" style={{ gap: '0.5em', flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => preset('today')}>Today</button>
          <button onClick={() => preset('week')}>This week</button>
          <button onClick={() => preset('month')}>This month</button>
          <button onClick={() => preset('lastmonth')}>Last month</button>
          <label>From <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
          <label>To <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
          <label>Vehicle{' '}
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="all">All vehicles</option>
              {rows.map((v) => <option key={v.id} value={String(v.id)}>{v.name}</option>)}
            </select>
          </label>
          <button onClick={() => window.print()}>Print</button>
        </div>
        <p className="hint">
          Live — refreshes every minute{updatedAt ? ` · updated ${updatedAt.toLocaleTimeString('en-ZA', { timeZone: SAST })}` : ''}.
          {' '}Calculated = from the route plans. Actual = from field punches (trips, stops, times) and fuel fill-ups (km, litres, fuel cost).
        </p>
        {error && <p className="warn">{error}</p>}
      </div>

      {alerts.map((s) => (
        <div key={s.vehicle_id} className="dash-alert" style={{ borderColor: STATE_META[s.state].color }}>
          <strong style={{ color: STATE_META[s.state].color }}>
            {s.state === 'overdue' ? '⚠ Service overdue' : '⚠ Service due soon'}: {s.name}
          </strong>
          {' — '}
          {s.state === 'overdue'
            ? `${fmtNum(Math.abs(s.remainingKm))} km past the ${fmtNum(s.intervalKm)} km interval`
            : `${fmtNum(s.remainingKm)} km left${s.workingDaysLeft != null ? ` (about ${s.workingDaysLeft} working days at ${fmtNum(s.kmPerWorkingDay)} km/day)` : ''}`}
          {s.basis === 'calculated' ? ' · based on calculated km' : ' · based on odometer'}
        </div>
      ))}

      <h3 style={{ marginBottom: 0 }}>{selected === 'all' ? 'Whole fleet' : shown[0]?.name}</h3>
      <div className="dash-tiles">
        {tile('Trips', `${fmtNum(vAct.tripsCompleted)} / ${fmtNum(view.calculated.trips)}`, 'completed / planned')}
        {tile('Stops', `${fmtNum(vAct.stopsCompleted)} / ${fmtNum(view.calculated.stops)}`, 'done / planned')}
        {tile('Delivery value', fmtR(punched ? vAct.deliveredValue : view.calculated.deliveryValue), punched ? `of ${fmtR(view.calculated.deliveryValue)} planned` : 'planned')}
        {tile('Distance', `${fmtNum(view.calculated.km, 1)} km`, vAct.km != null ? `${fmtNum(vAct.km, 1)} km by odometer` : 'planned')}
        {tile('Running cost', fmtR(view.calculated.runningCost), vAct.runningCost != null ? `${fmtR(vAct.runningCost)} actual` : 'calculated')}
        {tile('Cost per km', fmtR(view.calculated.costPerKm, 2), vAct.costPerKm != null ? `${fmtR(vAct.costPerKm, 2)} actual` : 'calculated')}
      </div>

      {shown.map((v) => (
        <section className="card" key={v.id}>
          <h3 style={{ marginTop: 0 }}>{v.name}{v.vehicle_type ? <span className="hint"> — {v.vehicle_type}</span> : null}</h3>
          {v.calculated.trips === 0
            ? <p className="hint">No trips in this period.</p>
            : <CompareTable calc={v.calculated} act={v.actual} haveActualData={actualAvailable(v.actual)} />}
          {v.calculated.trips > 0 && v.actual.fuelFills === 0 && <p className="hint">No fuel fill-ups logged for this vehicle in the period, so actual km, fuel and cost show “—”.</p>}
        </section>
      ))}

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Service tracker</h3>
        <p className="hint">Km since the last recorded service, up to today. Uses odometer readings from fuel fill-ups when both the service and a fill-up have one; otherwise the calculated km from the route plans.</p>
        <table className="dash-table">
          <thead>
            <tr><th>Vehicle</th><th>Status</th><th>Interval</th><th>Last service</th><th>Km since</th><th>Km left</th><th>Working days left</th><th className="no-print"></th></tr>
          </thead>
          <tbody>
            {data.service.map((s) => (
              <Fragment key={s.vehicle_id}>
                <tr>
                  <td>{s.name}</td>
                  <td style={{ color: STATE_META[s.state].color, fontWeight: 600 }}>{STATE_META[s.state].label}</td>
                  <td>{s.intervalKm != null ? `${fmtNum(s.intervalKm)} km` : '—'}</td>
                  <td>{fmtDate(s.lastServiceOn)}</td>
                  <td>
                    {s.usedKm != null ? `${fmtNum(s.usedKm, 1)} km` : '—'}
                    {s.usedKm != null && <div className="hint" style={{ margin: 0 }}>{s.basis === 'odometer' ? 'odometer' : 'calculated'}{s.basis === 'odometer' && s.calculatedKmSince != null ? ` · plan ${fmtNum(s.calculatedKmSince, 1)}` : ''}</div>}
                  </td>
                  <td>{s.remainingKm != null ? `${fmtNum(s.remainingKm, 0)} km` : '—'}</td>
                  <td>{s.workingDaysLeft != null ? s.workingDaysLeft : '—'}</td>
                  <td className="no-print">
                    <button onClick={() => { setSettingsForm(null); setServiceForm({ vehicle_id: s.vehicle_id, serviced_on: data.today, odometer_km: '', cost_rand: '', notes: '' }); }}>Record service</button>
                    {' '}
                    <button onClick={() => { setServiceForm(null); setSettingsForm({ vehicle_id: s.vehicle_id, interval: s.intervalKm ?? '', warn: s.warnKm }); }}>Settings</button>
                  </td>
                </tr>
                {serviceForm && serviceForm.vehicle_id === s.vehicle_id && (
                  <tr className="no-print"><td colSpan={8} style={{ textAlign: 'left' }}>
                    <div className="row" style={{ gap: '0.5em', flexWrap: 'wrap', alignItems: 'center' }}>
                      <strong>Record service for {s.name}</strong>
                      <label>Date <input type="date" value={serviceForm.serviced_on} onChange={(e) => setServiceForm({ ...serviceForm, serviced_on: e.target.value })} /></label>
                      <label>Odometer (km, optional) <input type="number" value={serviceForm.odometer_km} onChange={(e) => setServiceForm({ ...serviceForm, odometer_km: e.target.value })} style={{ width: '8em' }} /></label>
                      <label>Cost (R, optional) <input type="number" value={serviceForm.cost_rand} onChange={(e) => setServiceForm({ ...serviceForm, cost_rand: e.target.value })} style={{ width: '8em' }} /></label>
                      <label>Notes <input type="text" value={serviceForm.notes} onChange={(e) => setServiceForm({ ...serviceForm, notes: e.target.value })} /></label>
                      <button onClick={saveService} disabled={!serviceForm.serviced_on}>Save</button>
                      <button onClick={() => setServiceForm(null)}>Cancel</button>
                    </div>
                    <p className="hint">Km are counted from trips after this date. Adding the odometer reading lets future fuel fill-ups track the real km.</p>
                  </td></tr>
                )}
                {settingsForm && settingsForm.vehicle_id === s.vehicle_id && (
                  <tr className="no-print"><td colSpan={8} style={{ textAlign: 'left' }}>
                    <div className="row" style={{ gap: '0.5em', flexWrap: 'wrap', alignItems: 'center' }}>
                      <strong>Service settings for {s.name}</strong>
                      <label>Service every (km) <input type="number" value={settingsForm.interval} onChange={(e) => setSettingsForm({ ...settingsForm, interval: e.target.value })} style={{ width: '8em' }} /></label>
                      <label>Warn when within (km) <input type="number" value={settingsForm.warn} onChange={(e) => setSettingsForm({ ...settingsForm, warn: e.target.value })} style={{ width: '8em' }} /></label>
                      <button onClick={saveSettings}>Save</button>
                      <button onClick={() => setSettingsForm(null)}>Cancel</button>
                    </div>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {message && <p className="message no-print">{message}</p>}
      </section>
    </div>
  );
}
