import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const emptyForm = {
  name: '', vehicle_type: 'van', fuel_type: 'diesel',
  payload_limit_rand: '30000', crew_driver: '1', crew_helpers: '1',
  fuel_consumption_l_per_100km: '', avg_speed_kmh: '35',
};

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState([]);
  const [fuelPrices, setFuelPrices] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState('');

  async function load() {
    const [v, s] = await Promise.all([api.get('/api/vehicles'), api.get('/api/settings')]);
    setVehicles(v);
    setFuelPrices(s.fuelPrices);
  }
  useEffect(() => { load(); }, []);

  // Rank client-side the same way the optimizer does, so what you see here
  // matches what drives route assignment: cost per km, cheapest first.
  const priceByType = Object.fromEntries(fuelPrices.map((f) => [f.fuel_type, f.price_per_litre]));
  const ranked = [...vehicles]
    .map((v) => {
      const price = priceByType[v.fuel_type];
      const costPerKm = price != null ? (v.fuel_consumption_l_per_100km / 100) * price : null;
      return { ...v, costPerKm };
    })
    .sort((a, b) => (a.costPerKm ?? Infinity) - (b.costPerKm ?? Infinity));

  async function addVehicle(e) {
    e.preventDefault();
    setMessage('Saving...');
    try {
      await api.post('/api/vehicles', {
        name: form.name,
        vehicle_type: form.vehicle_type,
        fuel_type: form.fuel_type,
        payload_limit_rand: form.payload_limit_rand === '' ? null : parseFloat(form.payload_limit_rand),
        crew_driver: parseInt(form.crew_driver, 10),
        crew_helpers: parseInt(form.crew_helpers, 10),
        fuel_consumption_l_per_100km: parseFloat(form.fuel_consumption_l_per_100km),
        avg_speed_kmh: parseFloat(form.avg_speed_kmh),
      });
      setMessage(`${form.name} added.`);
      setForm(emptyForm);
      load();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  }

  async function toggleActive(vehicle) {
    await api.put(`/api/vehicles/${vehicle.id}`, { active: vehicle.active ? 0 : 1 });
    load();
  }

  return (
    <div className="page">
      <h2>Vehicles</h2>

      <section className="card">
        <h3>Efficiency ranking (best to worst)</h3>
        <p className="hint">
          Cheapest-to-run vehicle first. The route planner sends the LEAST efficient vehicle on the
          shortest routes (where its higher consumption costs the least) and saves the most efficient
          vehicle for the longest routes.
        </p>
        <table>
          <thead><tr><th>Rank</th><th>Vehicle</th><th>L/100km</th><th>R/km</th><th>Payload cap</th><th>Active</th></tr></thead>
          <tbody>
            {ranked.map((v, i) => (
              <tr key={v.id}>
                <td>{i + 1}{i === 0 && ' ⭐ most efficient'}{i === ranked.length - 1 && ranked.length > 1 && ' ⛽ least efficient'}</td>
                <td>{v.name}</td>
                <td>{v.fuel_consumption_l_per_100km.toFixed(1)}</td>
                <td>{v.costPerKm != null ? `R${v.costPerKm.toFixed(2)}` : '— (no fuel price yet)'}</td>
                <td>{v.payload_limit_rand ? `R${v.payload_limit_rand.toLocaleString()}` : 'Unlimited'}</td>
                <td><button onClick={() => toggleActive(v)}>{v.active ? 'Deactivate' : 'Activate'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>Add a vehicle</h3>
        <form onSubmit={addVehicle}>
          <div className="row">
            <label>Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label>Type
              <select value={form.vehicle_type} onChange={(e) => setForm({ ...form, vehicle_type: e.target.value })}>
                <option value="van">Van</option>
                <option value="truck">Truck</option>
              </select>
            </label>
            <label>Fuel
              <select value={form.fuel_type} onChange={(e) => setForm({ ...form, fuel_type: e.target.value })}>
                <option value="diesel">Diesel</option>
                <option value="petrol">Petrol</option>
              </select>
            </label>
          </div>
          <div className="row">
            <label>Payload cap (R, blank = unlimited)
              <input type="number" value={form.payload_limit_rand} onChange={(e) => setForm({ ...form, payload_limit_rand: e.target.value })} />
            </label>
            <label>Driver count
              <input type="number" value={form.crew_driver} onChange={(e) => setForm({ ...form, crew_driver: e.target.value })} />
            </label>
            <label>Helper count
              <input type="number" value={form.crew_helpers} onChange={(e) => setForm({ ...form, crew_helpers: e.target.value })} />
            </label>
          </div>
          <div className="row">
            <label>Starting fuel estimate (L/100km)
              <input type="number" step="0.1" value={form.fuel_consumption_l_per_100km} onChange={(e) => setForm({ ...form, fuel_consumption_l_per_100km: e.target.value })} required />
            </label>
            <label>Starting avg speed (km/h)
              <input type="number" value={form.avg_speed_kmh} onChange={(e) => setForm({ ...form, avg_speed_kmh: e.target.value })} />
            </label>
          </div>
          <p className="hint">Fuel and speed estimates refine automatically from real fill-ups and trips once the vehicle is in use.</p>
          <button type="submit">Add vehicle</button>
        </form>
        {message && <p className="message">{message}</p>}
      </section>
    </div>
  );
}
