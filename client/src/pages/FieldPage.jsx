import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';

const TRIP_CACHE_KEY = 'taza_field_trip_cache';
const STAFF_CACHE_KEY = 'taza_field_staff_cache';
const QUEUE_KEY = 'taza_field_punch_queue';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Google's consumer maps link only reliably takes about 9 waypoints plus a
// destination before it complains, so a long route (the 13-stop Isuzu days)
// gets split into consecutive legs instead of one link. Origin is left out
// deliberately — omitting it makes Google Maps use the driver's actual
// current location, which is more accurate than a fixed warehouse address
// and needs no extra data on this page.
const MAX_STOPS_PER_MAPS_LINK = 10;

function buildMapsLinks(stops) {
  const addresses = stops.map((s) => s.address).filter(Boolean);
  const links = [];
  for (let i = 0; i < addresses.length; i += MAX_STOPS_PER_MAPS_LINK) {
    const chunk = addresses.slice(i, i + MAX_STOPS_PER_MAPS_LINK);
    const destination = chunk[chunk.length - 1];
    const waypoints = chunk.slice(0, -1);
    const params = new URLSearchParams({ api: '1', destination, travelmode: 'driving' });
    if (waypoints.length > 0) params.set('waypoints', waypoints.join('|'));
    links.push(`https://www.google.com/maps/dir/?${params.toString()}`);
  }
  return links;
}
function loadQueue() {
  return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
}
function saveQueue(q) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

export default function FieldPage() {
  const [date] = useState(todayStr());
  const [trips, setTrips] = useState(() => JSON.parse(localStorage.getItem(TRIP_CACHE_KEY) || 'null'));
  const [selectedTripId, setSelectedTripId] = useState(null);
  const [queueSize, setQueueSize] = useState(loadQueue().length);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [staff, setStaff] = useState(() => JSON.parse(localStorage.getItem(STAFF_CACHE_KEY) || 'null') || []);
  // Day picker selections — one driver, one collector (both required before
  // Left Warehouse can fire), and any number of crew. Reset whenever a
  // different trip is selected.
  const [driverId, setDriverId] = useState('');
  const [collectorId, setCollectorId] = useState('');
  const [crewIds, setCrewIds] = useState([]);

  const flushQueue = useCallback(async () => {
    let queue = loadQueue();
    if (queue.length === 0) return;
    setSyncing(true);
    const remaining = [];
    for (const item of queue) {
      try {
        await api.post(item.path, item.body);
      } catch (err) {
        remaining.push(item); // keep for next retry
      }
    }
    saveQueue(remaining);
    setQueueSize(remaining.length);
    setSyncing(false);
  }, []);

  useEffect(() => {
    flushQueue();
    window.addEventListener('online', flushQueue);
    const interval = setInterval(flushQueue, 30000);
    return () => {
      window.removeEventListener('online', flushQueue);
      clearInterval(interval);
    };
  }, [flushQueue]);

  async function syncTodaysPlan() {
    try {
      const [data, staffList] = await Promise.all([
        api.get(`/api/planning/${date}`),
        api.get('/api/staff'),
      ]);
      localStorage.setItem(TRIP_CACHE_KEY, JSON.stringify(data));
      localStorage.setItem(STAFF_CACHE_KEY, JSON.stringify(staffList));
      setTrips(data);
      setStaff(staffList);
      setMessage('Today’s plan is cached — this device can now work offline.');
    } catch (err) {
      setMessage(`Could not fetch plan (are you online and connected to the server?): ${err.message}`);
    }
  }

  function toggleCrew(id) {
    setCrewIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // Every punch: apply optimistically to local state (so the UI feels
  // instant regardless of connectivity), then either send immediately or
  // queue it. Queued punches sync automatically once back online.
  async function punch(path, body, applyLocal) {
    const timestamp = new Date().toISOString();
    const fullBody = { ...body, timestamp };
    applyLocal(timestamp);
    localStorage.setItem(TRIP_CACHE_KEY, JSON.stringify(trips));

    try {
      await api.post(path, fullBody);
    } catch (err) {
      const queue = loadQueue();
      queue.push({ path, body: fullBody });
      saveQueue(queue);
      setQueueSize(queue.length);
    }
  }

  if (!trips) {
    return (
      <div className="page">
        <h2>Field — punch clock</h2>
        <p className="hint">No plan cached on this device yet. Connect to the warehouse WiFi/server once this morning and tap below to load today's routes for offline use in the field.</p>
        <button onClick={syncTodaysPlan}>Load today's plan</button>
        {message && <p className="message">{message}</p>}
      </div>
    );
  }

  const trip = trips.find((t) => t.id === selectedTripId) || null;

  return (
    <div className="page">
      <h2>Field — punch clock</h2>
      <p className="hint">
        {queueSize > 0 ? `⚠ ${queueSize} punch(es) waiting to sync${syncing ? ' — syncing now...' : ''}` : '✓ All punches synced'}
      </p>
      <button onClick={syncTodaysPlan}>Refresh today's plan</button>
      <button onClick={flushQueue} disabled={syncing}>Sync now</button>

      {!trip && (
        <section className="card">
          <h3>Select vehicle</h3>
          <ul className="plain">
            {trips.map((t) => (
              <li key={t.id}>
                <button onClick={() => { setSelectedTripId(t.id); setDriverId(''); setCollectorId(''); setCrewIds([]); }}>
                  Trip #{t.id} — {t.stops.length} stops — {t.status}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {trip && (
        <section className="card">
          <button onClick={() => { setSelectedTripId(null); setDriverId(''); setCollectorId(''); setCrewIds([]); }}>← back to trips</button>
          <h3>Trip #{trip.id}</h3>

          {!trip.left_warehouse_at ? (
            <div className="card">
              <h4>Who's on this vehicle today?</h4>
              <div className="row">
                <label>Driver
                  <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                    <option value="">— select —</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label>Cash collector
                  <select value={collectorId} onChange={(e) => setCollectorId(e.target.value)}>
                    <option value="">— select —</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              </div>
              <div className="row">
                <span>Crew (optional):</span>
                {staff.map((s) => (
                  <label key={s.id} style={{ marginRight: '0.75em' }}>
                    <input type="checkbox" checked={crewIds.includes(s.id)} onChange={() => toggleCrew(s.id)} />
                    {' '}{s.name}
                  </label>
                ))}
              </div>
              <button
                className="big"
                disabled={!driverId || !collectorId}
                onClick={() => {
                  // Open synchronously, in the same click, so the browser
                  // doesn't treat it as a blocked pop-up — punch() below is
                  // async and firing the map open after an await would risk
                  // that.
                  const links = buildMapsLinks(trip.stops);
                  if (links[0]) window.open(links[0], '_blank', 'noopener');
                  punch(
                    '/api/punches/left-warehouse',
                    { trip_id: trip.id, driver_id: driverId, cash_collected_by: collectorId, crew_ids: crewIds },
                    (ts) => { trip.left_warehouse_at = ts; setTrips([...trips]); }
                  );
                }}
              >
                Left Warehouse
              </button>
              {(!driverId || !collectorId) && <p className="hint">Driver and cash collector are required before leaving.</p>}
            </div>
          ) : (
            <>
              <p className="hint">Left warehouse: {new Date(trip.left_warehouse_at).toLocaleTimeString()}</p>
              <div className="row" style={{ gap: '0.5em', marginBottom: '1em' }}>
                {buildMapsLinks(trip.stops).map((link, i, arr) => (
                  <a key={link} href={link} target="_blank" rel="noopener noreferrer">
                    <button type="button">{arr.length > 1 ? `Open route in Maps (stops ${i * MAX_STOPS_PER_MAPS_LINK + 1}-${Math.min((i + 1) * MAX_STOPS_PER_MAPS_LINK, trip.stops.length)})` : 'Open route in Maps'}</button>
                  </a>
                ))}
              </div>
              <ol>
                {trip.stops.map((stop) => (
                  <li key={stop.id} style={{ marginBottom: '1em' }}>
                    <strong>{stop.customer_name}</strong> — {stop.address}
                    <div className="hint">
                      {stop.delivery_value_rand > 0 && <span>Deliver R{stop.delivery_value_rand} </span>}
                      {stop.collection_amount_rand > 0 && <span>· Collect R{stop.collection_amount_rand} cash</span>}
                    </div>
                    <div className="row">
                      {!stop.arrived_at ? (
                        <button onClick={() => punch('/api/punches/arrived', { trip_stop_id: stop.id }, (ts) => { stop.arrived_at = ts; setTrips([...trips]); })}>
                          Arrived
                        </button>
                      ) : !stop.left_at ? (
                        <button onClick={() => punch('/api/punches/left-customer', { trip_stop_id: stop.id }, (ts) => { stop.left_at = ts; setTrips([...trips]); })}>
                          Left customer
                        </button>
                      ) : (
                        <span>✓ {new Date(stop.arrived_at).toLocaleTimeString()} → {new Date(stop.left_at).toLocaleTimeString()}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>

              {trip.stops.every((s) => s.left_at) && !trip.back_at_warehouse_at && (
                <button className="big" onClick={() => punch('/api/punches/back-at-warehouse', { trip_id: trip.id }, (ts) => { trip.back_at_warehouse_at = ts; setTrips([...trips]); })}>
                  Back at Warehouse
                </button>
              )}
              {trip.back_at_warehouse_at && <p className="message">Trip complete — {new Date(trip.back_at_warehouse_at).toLocaleTimeString()}</p>}
            </>
          )}
        </section>
      )}

      {message && <p className="message">{message}</p>}
    </div>
  );
}
