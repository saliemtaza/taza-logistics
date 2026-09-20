import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatDuration(minutes) {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function LoadingPage() {
  const [date, setDate] = useState(today());
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setLoading(true);
    try {
      setTrips(await api.get(`/api/loading/${date}`));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [date]);

  async function startLoad(tripId) {
    setBusyId(tripId);
    try {
      await api.post(`/api/loading/${tripId}/start`, {});
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function endLoad(tripId) {
    setBusyId(tripId);
    try {
      await api.post(`/api/loading/${tripId}/end`, {});
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page">
      <h2>Loading</h2>
      <p className="hint">
        For each vehicle's route, works backward from close time through drive/dwell time and that
        vehicle's learned loading time to show when loading needs to start. Log the real Start/End
        Load times as they happen — this also refines the learned estimate for next time.
      </p>

      <section className="card">
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </section>

      {loading && <p>Loading...</p>}

      {!loading && trips.length === 0 && (
        <p className="hint">No planned trips for this date yet — generate a route plan first.</p>
      )}

      {trips.map((trip) => {
        const actualMinutes = trip.load_started_at && trip.load_ended_at
          ? (new Date(trip.load_ended_at) - new Date(trip.load_started_at)) / 60000
          : null;

        return (
          <section className="card" key={trip.id}>
            <h3>{trip.vehicle_name}</h3>
            {!trip.hasDeliveries && (
              <p className="hint">Cash collection only — no goods loaded, so no warehouse loading time applies.</p>
            )}
            <table>
              <tbody>
                <tr>
                  <td>Must start loading by</td>
                  <td><strong>{trip.mustStartLoadingBy}</strong></td>
                </tr>
                <tr>
                  <td>Drive + dwell time</td>
                  <td>{formatDuration(trip.driveDwellMinutes)}</td>
                </tr>
                {trip.hasDeliveries && (
                  <tr>
                    <td>Learned loading time (this vehicle)</td>
                    <td>{formatDuration(trip.avg_loading_minutes)}</td>
                  </tr>
                )}
                <tr>
                  <td>Start Load</td>
                  <td>
                    {trip.load_started_at
                      ? formatTime(trip.load_started_at)
                      : <button onClick={() => startLoad(trip.id)} disabled={busyId === trip.id}>Start Load</button>}
                  </td>
                </tr>
                <tr>
                  <td>End Load</td>
                  <td>
                    {trip.load_ended_at
                      ? formatTime(trip.load_ended_at)
                      : trip.load_started_at
                        ? <button onClick={() => endLoad(trip.id)} disabled={busyId === trip.id}>End Load</button>
                        : '—'}
                  </td>
                </tr>
                {actualMinutes != null && (
                  <tr>
                    <td>Actual loading time (today)</td>
                    <td>{formatDuration(actualMinutes)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
