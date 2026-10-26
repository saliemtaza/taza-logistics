import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { isOutsideGauteng, NOT_IN_GAUTENG_LABEL } from '../lib/geo.js';

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
        <thead><tr><th>Load order</th><th>Customer</th><th>Delivery stop</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body></html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

// Same load-order convention as printLoadingSheet (last stop loaded first),
// combined into one document — vehicle sections flow continuously with no
// forced page break between them, so a short day fits on one printed page
// (a longer day will still spill to a second page naturally).
function printAllLoadingSheets(routes, date) {
  const win = window.open('', '_blank', 'width=600,height=800');
  if (!win) { alert('Please allow pop-ups to print loading sheets.'); return; }

  const sections = routes.map((route) => {
    const loadOrder = [...route.stops].reverse();
    const rows = loadOrder.map((s, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(s.name)}</td>
        <td>Stop ${route.stops.length - i} of ${route.stops.length}</td>
      </tr>
    `).join('');

    return `
      <section>
        <h1>Loading Sheet — ${escapeHtml(route.vehicle.name)} — ${date}</h1>
        <p class="note">Load in this order top to bottom: #1 goes in first (deepest in the vehicle), the last row goes in last (nearest the door — first stop's order, so it comes off first).</p>
        <table>
          <thead><tr><th>Load order</th><th>Customer</th><th>Delivery stop</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    `;
  }).join('');

  win.document.write(`
    <html><head><title>Loading Sheets — All Vehicles — ${date}</title>
    <style>
      body { font-family: sans-serif; padding: 20px; }
      h1 { font-size: 1.2rem; margin-bottom: 0.25em; }
      .note { color: #555; font-size: 0.85rem; margin-bottom: 1em; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 2em; }
      th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; font-size: 0.9rem; }
      th { background: #eee; }
    </style>
    </head><body>${sections}</body></html>
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
  const [reversed, setReversed] = useState(false);
  const [moveWarning, setMoveWarning] = useState('');
  const [selectedStops, setSelectedStops] = useState({}); // trip_id -> array of selected customer_ids
  const [selectedOverflow, setSelectedOverflow] = useState([]); // array of selected customer_ids from the overflow list
  // Drag-and-drop state. dragging holds the stop currently being dragged —
  // fromTripId is null for an overflow (unassigned) stop. dragOverKey marks
  // whichever drop target the pointer is currently over, purely for the
  // highlight — it plays no part in deciding what happens on drop.
  const [dragging, setDragging] = useState(null); // { fromTripId: number|null, customerId }
  const [dragOverKey, setDragOverKey] = useState(null);

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
    setMoveWarning('');
    try {
      await saveAvailability();
      const result = await api.post('/api/planning/generate', { date, useRoadRouting, reversed });
      setPlan(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function toggleStopSelected(tripId, customerId) {
    setSelectedStops((prev) => {
      const current = prev[tripId] || [];
      const next = current.includes(customerId)
        ? current.filter((id) => id !== customerId)
        : [...current, customerId];
      return { ...prev, [tripId]: next };
    });
  }

  // Moves every checked stop on fromRoute to toRoute in one action. Each
  // stop still goes through the same /move-stop endpoint (and so the same
  // moveStop() re-sequencing) one at a time under the hood — the backend
  // always reloads the current trip state from the DB, so calling it
  // sequentially for several customers is safe, it just shows as one bulk
  // action from the user's side instead of repeating the picker per stop.
  async function moveSelectedStopsTo(fromRoute, toRoute) {
    const customerIds = selectedStops[fromRoute.trip_id] || [];
    if (customerIds.length === 0) return;
    setBusy(true);
    setError('');
    let latestWarning = '';
    try {
      for (const customerId of customerIds) {
        const result = await api.post('/api/planning/move-stop', {
          date,
          fromTripId: fromRoute.trip_id,
          toTripId: toRoute.trip_id,
          customerId,
        });
        setPlan((prev) => ({
          ...prev,
          routes: prev.routes.map((r) => {
            if (r.trip_id === result.fromRoute.trip_id) return { ...r, ...result.fromRoute };
            if (r.trip_id === result.toRoute.trip_id) return { ...r, ...result.toRoute };
            return r;
          }),
        }));
        if (result.warning) latestWarning = result.warning;
      }
      setMoveWarning(latestWarning);
      setSelectedStops((prev) => ({ ...prev, [fromRoute.trip_id]: [] }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function toggleOverflowSelected(customerId) {
    setSelectedOverflow((prev) =>
      prev.includes(customerId) ? prev.filter((id) => id !== customerId) : [...prev, customerId]
    );
  }

  // Moves every checked overflow (unassigned) order onto toRoute, one at a
  // time through the same /move-stop endpoint as moveSelectedStopsTo — just
  // with no fromTripId, since these were never on any vehicle's trip yet.
  // Each success removes that customer from the overflow list locally and
  // updates the destination route in place.
  async function moveSelectedOverflowTo(toRoute) {
    if (selectedOverflow.length === 0) return;
    setBusy(true);
    setError('');
    let latestWarning = '';
    try {
      for (const customerId of selectedOverflow) {
        const result = await api.post('/api/planning/move-stop', {
          date,
          toTripId: toRoute.trip_id,
          customerId,
        });
        setPlan((prev) => ({
          ...prev,
          overflow: prev.overflow.filter((o) => o.customer_id !== customerId),
          routes: prev.routes.map((r) => (r.trip_id === result.toRoute.trip_id ? { ...r, ...result.toRoute } : r)),
        }));
        if (result.warning) latestWarning = result.warning;
      }
      setMoveWarning(latestWarning);
      setSelectedOverflow([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Re-orders the stops WITHIN one vehicle's route (no stop joins/leaves
  // it) — this is the fast path for fixing a zigzag by hand: drag one stop
  // a few places up or down instead of the select-and-move-elsewhere flow.
  // Goes through /api/planning/reorder-stops, which uses the FIXED-order
  // costing so the manual order sticks instead of the optimizer resequencing
  // it straight back out.
  async function reorderWithinRoute(route, orderedCustomerIds) {
    setBusy(true);
    setError('');
    try {
      const result = await api.post('/api/planning/reorder-stops', { date, tripId: route.trip_id, orderedCustomerIds });
      setPlan((prev) => ({
        ...prev,
        routes: prev.routes.map((r) => (r.trip_id === result.route.trip_id ? { ...r, ...result.route } : r)),
      }));
      setMoveWarning(result.warning || '');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Explicit full re-sequence of one vehicle's route by the optimizer — the
  // only action that discards the current order (moves and drag-reorders
  // keep it), so it asks first.
  async function optimiseRouteOrder(route) {
    if (!window.confirm(`Re-sequence ${route.vehicle.name}'s route automatically? This replaces the current stop order, including any order you set by hand.`)) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.post('/api/planning/optimise-route', { date, tripId: route.trip_id });
      setPlan((prev) => ({
        ...prev,
        routes: prev.routes.map((r) => (r.trip_id === result.route.trip_id ? { ...r, ...result.route } : r)),
      }));
      setMoveWarning(result.warning || '');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Drag-and-drop equivalent of the existing checkbox + "move to" pickers,
  // for a single stop at a time — same /move-stop endpoint, fromTripId
  // omitted when the stop is coming off the overflow list. Faster for one
  // stop; the checkbox flow above still covers moving several at once.
  async function moveSingleStop(fromTripId, toTripId, customerId) {
    setBusy(true);
    setError('');
    try {
      const body = { date, toTripId, customerId };
      if (fromTripId != null) body.fromTripId = fromTripId;
      const result = await api.post('/api/planning/move-stop', body);
      setPlan((prev) => ({
        ...prev,
        overflow: fromTripId == null ? prev.overflow.filter((o) => o.customer_id !== customerId) : prev.overflow,
        routes: prev.routes.map((r) => {
          if (result.fromRoute && r.trip_id === result.fromRoute.trip_id) return { ...r, ...result.fromRoute };
          if (r.trip_id === result.toRoute.trip_id) return { ...r, ...result.toRoute };
          return r;
        }),
      }));
      setMoveWarning(result.warning || '');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleStopDragStart(fromTripId, customerId) {
    return (e) => {
      setDragging({ fromTripId: fromTripId ?? null, customerId });
      e.dataTransfer.effectAllowed = 'move';
    };
  }

  function handleDragEnd() {
    setDragging(null);
    setDragOverKey(null);
  }

  function handleDragOverTarget(key) {
    return (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragOverKey !== key) setDragOverKey(key);
    };
  }

  // Dropped directly on another stop: if it's within the SAME route, that's
  // a reorder to this position; if it's a different route (or overflow),
  // that's a move onto this route (the exact landing position is then
  // decided by the move's own re-sequencing, same as the checkbox flow).
  function handleDropOnStop(route, dropIndex) {
    return (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverKey(null);
      if (!dragging || busy) return;
      const { fromTripId, customerId } = dragging;
      setDragging(null);
      if (fromTripId === route.trip_id) {
        const currentIds = route.stops.map((s) => s.customer_id);
        const fromIndex = currentIds.indexOf(customerId);
        if (fromIndex === -1 || fromIndex === dropIndex) return;
        const next = [...currentIds];
        next.splice(fromIndex, 1);
        const insertAt = fromIndex < dropIndex ? dropIndex - 1 : dropIndex;
        next.splice(insertAt, 0, customerId);
        reorderWithinRoute(route, next);
      } else {
        moveSingleStop(fromTripId, route.trip_id, customerId);
      }
    };
  }

  // Dropped on the route's section background rather than on a specific
  // stop (e.g. an empty route, or below the last stop) — always a move
  // onto this route, landing position decided by the move itself.
  function handleDropOnRouteSection(route) {
    return (e) => {
      e.preventDefault();
      setDragOverKey(null);
      if (!dragging || busy) return;
      const { fromTripId, customerId } = dragging;
      setDragging(null);
      if (fromTripId === route.trip_id) return;
      moveSingleStop(fromTripId, route.trip_id, customerId);
    };
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

      <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5em' }}>
        <input type="checkbox" checked={reversed} onChange={(e) => setReversed(e.target.checked)} />
        Reverse stop order (so a cut-short day leaves different customers for last next time)
      </label>

      <div className="row">
        <button onClick={() => generate(true)} disabled={busy}>Generate plan (with Google road distances)</button>
        <button onClick={() => generate(false)} disabled={busy}>Generate plan (straight-line only, works offline)</button>
      </div>

      {error && <p className="error">{error}</p>}
      {plan?.warnings?.length > 0 && plan.warnings.map((w, i) => <p key={i} className="warn">{w}</p>)}

      {plan && (
        <>
          <p className="hint">Total: {totalKm?.toFixed(1)} km — est. fuel cost R{totalCost?.toFixed(2)}{reversed && ' — stop order reversed'}</p>

          {moveWarning && (
            <p className="warn">
              {moveWarning}{' '}
              <button className="link" onClick={() => setMoveWarning('')}>dismiss</button>
            </p>
          )}

          {plan.routes.length > 1 && (
            <button onClick={() => printAllLoadingSheets(plan.routes, date)}>Print all loading sheets</button>
          )}


          {plan.overflow.length > 0 && (
            <section className="card error">
              <h3>Could not fit today ({plan.overflow.length})</h3>
              <ul>
                {plan.overflow.map((o) => (
                  <li
                    key={o.customer_id}
                    draggable={!busy}
                    onDragStart={handleStopDragStart(null, o.customer_id)}
                    onDragEnd={handleDragEnd}
                    style={{ cursor: busy ? 'default' : 'grab' }}
                  >
                    <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5em' }}>
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={selectedOverflow.includes(o.customer_id)}
                        onChange={() => toggleOverflowSelected(o.customer_id)}
                      />
                      <span title="Drag onto a vehicle below to place it">{'\u2630'}</span>
                      {o.name}
                      {isOutsideGauteng(o.lat, o.lng) && <span className="warn"> {NOT_IN_GAUTENG_LABEL}</span>}
                      {o.value_rand > 0 && ` — deliver R${o.value_rand}`}
                      {o.collection_amount_rand > 0 ? ` — collect R${o.collection_amount_rand}` : (o.has_collection && ' — cash collection')}
                    </label>
                  </li>
                ))}
              </ul>
              <p className="hint">These didn't fit within the fleet's capacity/time window. Consider a second wave, marking another vehicle available, or adding a vehicle.</p>
              {plan.routes.length > 0 && selectedOverflow.length > 0 && (
                <div className="row" style={{ alignItems: 'center', gap: '0.5em' }}>
                  <span className="hint">{selectedOverflow.length} selected — move to:</span>
                  <select
                    disabled={busy}
                    defaultValue=""
                    onChange={(e) => {
                      const target = plan.routes.find((r) => String(r.trip_id) === e.target.value);
                      if (target) moveSelectedOverflowTo(target);
                      e.target.value = '';
                    }}
                  >
                    <option value="" disabled>Choose vehicle…</option>
                    {plan.routes.map((r) => (
                      <option key={r.trip_id} value={r.trip_id}>{r.vehicle.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </section>
          )}

          {plan.routes.map((route) => (
            <section
              className="card"
              key={route.trip_id}
              onDragOver={handleDragOverTarget(`route-${route.trip_id}`)}
              onDrop={handleDropOnRouteSection(route)}
              style={dragOverKey === `route-${route.trip_id}` ? { background: '#eef3ff' } : undefined}
            >
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
              {' '}
              <button onClick={() => optimiseRouteOrder(route)} disabled={busy}>Optimise order</button>
              <p className="hint">Drag a stop to reorder it within this route, or onto another vehicle to move it there — a moved stop goes in where it adds the least distance and the rest of the order stays as it is. "Optimise order" re-sequences the whole route automatically.</p>
              <ol>
                {route.stops.map((s, i) => {
                  const key = `${route.trip_id}-${i}`;
                  return (
                    <li
                      key={s.customer_id}
                      draggable={!busy}
                      onDragStart={handleStopDragStart(route.trip_id, s.customer_id)}
                      onDragEnd={handleDragEnd}
                      onDragOver={handleDragOverTarget(key)}
                      onDrop={handleDropOnStop(route, i)}
                      style={{
                        cursor: busy ? 'default' : 'grab',
                        background: dragOverKey === key ? '#dbe6ff' : undefined,
                      }}
                    >
                      <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5em' }}>
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={(selectedStops[route.trip_id] || []).includes(s.customer_id)}
                          onChange={() => toggleStopSelected(route.trip_id, s.customer_id)}
                        />
                        <span title="Drag to reorder or move">{'\u2630'}</span>
                        {s.name} — {s.address}
                        {isOutsideGauteng(s.lat, s.lng) && <span className="warn"> {NOT_IN_GAUTENG_LABEL}</span>}
                        {' '}({route.legDistancesKm[i]?.toFixed(1)} km leg)
                        {s.value_rand > 0 && <span> · deliver R{s.value_rand}</span>}
                        {s.collection_amount_rand > 0
                          ? <span> · collect R{s.collection_amount_rand}</span>
                          : (s.has_collection && <span> · cash collection</span>)}
                      </label>
                    </li>
                  );
                })}
              </ol>
              {plan.routes.length > 1 && (selectedStops[route.trip_id] || []).length > 0 && (
                <div className="row" style={{ alignItems: 'center', gap: '0.5em' }}>
                  <span className="hint">{selectedStops[route.trip_id].length} selected — move to:</span>
                  <select
                    disabled={busy}
                    defaultValue=""
                    onChange={(e) => {
                      const target = plan.routes.find((r) => String(r.trip_id) === e.target.value);
                      if (target) moveSelectedStopsTo(route, target);
                      e.target.value = '';
                    }}
                  >
                    <option value="" disabled>Choose vehicle…</option>
                    {plan.routes.filter((r) => r.trip_id !== route.trip_id).map((r) => (
                      <option key={r.trip_id} value={r.trip_id}>{r.vehicle.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
