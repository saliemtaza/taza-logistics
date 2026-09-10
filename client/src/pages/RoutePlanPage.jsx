import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Loading sheet: LAST delivery stop is loaded first (goes in deepest), FIRST
// delivery stop is loaded last (nearest the door — so it's the first thing
// off the vehicle when the driver reaches their first stop). Opens a
// separate, minimal print window so it comes out as a clean physical sheet
// rather than the whole app UI.
function printLoadingSheet(route, date) {
  const loadOrder = [...route.stops].reverse();
  const win = window.open('', '_blank', 'width=600,height=800');
  if (!win) { alert('Please allow pop-ups to print the loading sheet.'); return; }

  const rows = loadOrder.map((s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(s.name)}</td>
      <td>Stop ${route.stops.length - i} of ${route.stops.length}</td>
      <td>${s.value_rand > 0 ? 'R' + s.value_rand : ''}</td>
      <td>${s.collection_amount_rand > 0 ? 'R' + s.collection_amount_rand : ''}</td>
    </tr>
  `).join('');

  win.document.write(`
    <html><head><title>Loading Sheet — ${escapeHtml(route.vehicle.name)} — ${date}</title>
    <style>
      body { font-family: sans-serif; padding: 20px; }
      h1 { font-size: 1.2rem; margin-bottom: 0.25em; }
      .note { color: #555; font-size: 0.85rem; margin-bottom: 1em; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; font-size: 0.9rem; }
      th { background: #eee; }
    </style>
    </head><body>
      <h1>Loading Sheet — ${escapeHtml(route.vehicle.name)} — ${date}</h1>
      <p class="note">Load in this order top to bottom: #1 goes in first (deepest in the vehicle), the last row goes in last (nearest the door — first stop's order, so it comes off first).</p>
      <table>
        <thead><tr><th>Load order</th><th>Customer</th><th>Delivery stop</th><th>Deliver</th><th>Collect</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body></html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export default function RoutePlanPage() {
  const [date, setDate] = useState(todayStr());
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [vehicles, setVehicles] = useState([]);
  const [unavailable, setUnavailable] = useState({}); // vehicle_id -> true if unavailable today
  const [collectionsCount, setCollectionsCount] = useState(null);

  async function loadVehicleAvailability() {
    const rows = await api.get(`/api/vehicles/availability?date=${date}`);
    setVehicles(rows);
    const unavailMap = {};
    for (const v of rows) if (!v.available) unavailMap[v.id] = true;
    setUnavailable(unavailMap);
  }
  async function loadCollectionsCount() {
    const rows = await api.get(`/api/collections?date=${date}`);
    setCollectionsCount(rows.length);
  }
  useEffect(() => { loadVehicleAvailability(); loadCollectionsCount(); setPlan(null); }, [date]);

  function toggleVehicle(id) {
    setUnavailable((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function saveAvailability() {
    const availability = vehicles.map((v) => ({ vehicle_id: v.id, available: !unavailable[v.id] }));
    await api.post('/api/vehicles/availability', { date, availability });
  }

  async function generate(useRoadRouting) {
    setBusy(true);
    setError('');
    setPlan(null);
    try {
      await saveAvailability();
      const result = await api.post('/api/planning/generate', { date, useRoadRouting });
      setPlan(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const totalCost = plan?.routes.reduce((s, r) => s + (r.fuelCost || 0), 0);
  const totalKm = plan?.routes.reduce((s, r) => s + r.totalDistanceKm, 0);
  const availableCount = vehicles.filter((v) => !unavailable[v.id]).length;

  return (
    <div className="page">
      <h2>Route plan</h2>
      <label>Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>

      {collectionsCount === 0 && (
        <section className="card" style={{ borderLeft: '4px solid #b35c00' }}>
          <strong>Any cash collections today?</strong>
          <p className="hint">No collections are logged for {date} yet. If there are none, ignore this. Otherwise, add them before generating so they're included on the route.</p>
        </section>
      )}

      <section className="card">
        <h3>Vehicles available today</h3>
        {vehicles.map((v) => (
          <label key={v.id} style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5em' }}>
            <input type="checkbox" checked={!unavailable[v.id]} onChange={() => toggleVehicle(v.id)} />
            {v.name}
          </label>
        ))}
        <p className="hint">{availableCount} of {vehicles.length} vehicle(s) available for {date}.</p>
      </section>

      <div className="row">
        <button onClick={() => generate(true)} disabled={busy}>Generate plan (with Google road distances)</button>
        <button onClick={() => generate(false)} disabled={busy}>Generate plan (straight-line only, works offline)</button>
      </div>

      {error && <p className="error">{error}</p>}
      {plan?.warnings?.length > 0 && plan.warnings.map((w, i) => <p key={i} className="warn">{w}</p>)}

      {plan && (
        <>
          <p className="hint">Total: {totalKm?.toFixed(1)} km — est. fuel cost R{totalCost?.toFixed(2)}</p>

          {plan.overflow.length > 0 && (
            <section className="card error">
              <h3>Could not fit today ({plan.overflow.length})</h3>
              <ul>
                {plan.overflow.map((o) => (
                  <li key={o.customer_id}>
                    {o.name}
                    {o.value_rand > 0 && ` — deliver R${o.value_rand}`}
                    {o.collection_amount_rand > 0 && ` — collect R${o.collection_amount_rand}`}
                  </li>
                ))}
              </ul>
              <p className="hint">These didn't fit within the fleet's capacity/time window. Consider a second wave, marking another vehicle available, or adding a vehicle.</p>
            </section>
          )}

          {plan.routes.map((route) => (
            <section className="card" key={route.trip_id}>
              <h3>
                {route.vehicle.name} — rank {route.vehicle.efficiencyRank} of {vehicles.length} efficiency
                {route.vehicle.costPerKm != null && ` (R${route.vehicle.costPerKm.toFixed(2)}/km)`}
                {!route.fitsWindow && <span className="warn"> — over time budget</span>}
              </h3>
              <p className="hint">
                {route.stops.length} stops — {route.totalDistanceKm.toFixed(1)} km — {(route.totalDurationMin / 60).toFixed(1)} hrs —
                {' '}R{route.totalValueRand?.toFixed(0)} payload
                {route.fuelCost != null && ` — est. fuel R${route.fuelCost.toFixed(2)}`}
              </p>
              <button onClick={() => printLoadingSheet(route, date)}>Print loading sheet</button>
              <ol>
                {route.stops.map((s, i) => (
                  <li key={s.customer_id}>
                    {s.name} — {s.address} ({route.legDistancesKm[i]?.toFixed(1)} km leg)
                    {s.value_rand > 0 && <span> · deliver R{s.value_rand}</span>}
                    {s.collection_amount_rand > 0 && <span> · collect R{s.collection_amount_rand}</span>}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
