import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function FuelLogPage() {
  const [vehicles, setVehicles] = useState([]);
  const [vehicleId, setVehicleId] = useState('');
  const [odometer, setOdometer] = useState('');
  const [litres, setLitres] = useState('');
  const [cost, setCost] = useState('');
  const [logs, setLogs] = useState([]);
  const [message, setMessage] = useState('');

  async function loadVehicles() {
    const v = await api.get('/api/vehicles');
    setVehicles(v);
    if (!vehicleId && v.length) setVehicleId(String(v[0].id));
  }
  async function loadLogs() {
    setLogs(await api.get('/api/fuel-logs'));
  }
  useEffect(() => { loadVehicles(); loadLogs(); }, []);

  async function submit(e) {
    e.preventDefault();
    setMessage('Saving...');
    try {
      const res = await api.post('/api/fuel-logs', {
        vehicle_id: parseInt(vehicleId, 10),
        odometer_km: parseFloat(odometer),
        litres: parseFloat(litres),
        cost_rand: parseFloat(cost),
      });
      const observed = res.log.l_per_100km_observed;
      setMessage(
        observed
          ? `Saved. This fill-up: ${observed.toFixed(1)} L/100km over ${res.log.km_since_last.toFixed(0)} km. Vehicle estimate is now ${res.vehicle.fuel_consumption_l_per_100km.toFixed(1)} L/100km.`
          : 'Saved — first fill-up logged for this vehicle, nothing to compare against yet.'
      );
      setOdometer(''); setLitres(''); setCost('');
      loadLogs();
      loadVehicles();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  }

  const vehicleName = (id) => vehicles.find((v) => v.id === id)?.name || id;

  return (
    <div className="page">
      <h2>Fuel log</h2>
      <p className="hint">
        Log every fill-up here — just the three numbers on the pump slip, plus the odometer reading.
        The app works out actual L/100km itself from the distance since the last fill-up, and uses the
        real Rand/litre paid to keep fuel cost estimates current. No one needs to estimate litres per trip.
      </p>

      <section className="card">
        <h3>New fill-up</h3>
        <form onSubmit={submit}>
          <label>Vehicle
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <div className="row">
            <label>Odometer reading (km)
              <input type="number" value={odometer} onChange={(e) => setOdometer(e.target.value)} required />
            </label>
            <label>Litres filled
              <input type="number" step="0.01" value={litres} onChange={(e) => setLitres(e.target.value)} required />
            </label>
            <label>Total paid (R)
              <input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} required />
            </label>
          </div>
          <button type="submit">Log fill-up</button>
        </form>
        {message && <p className="message">{message}</p>}
      </section>

      <section className="card">
        <h3>Current learned consumption per vehicle</h3>
        <table>
          <thead><tr><th>Vehicle</th><th>L/100km (learned)</th></tr></thead>
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.id}><td>{v.name}</td><td>{v.fuel_consumption_l_per_100km.toFixed(1)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>Fill-up history</h3>
        <table>
          <thead><tr><th>Date</th><th>Vehicle</th><th>Odometer</th><th>Litres</th><th>Paid</th><th>km since last</th><th>Observed L/100km</th></tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{new Date(l.filled_at).toLocaleDateString()}</td>
                <td>{l.vehicle_name || vehicleName(l.vehicle_id)}</td>
                <td>{l.odometer_km}</td>
                <td>{l.litres}</td>
                <td>R{l.cost_rand.toFixed(2)}</td>
                <td>{l.km_since_last != null ? l.km_since_last.toFixed(0) : '—'}</td>
                <td>{l.l_per_100km_observed != null ? l.l_per_100km_observed.toFixed(1) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
