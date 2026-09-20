import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const emptyForm = {
  name: '', vehicle_type: 'van', fuel_type: 'diesel',
  payload_limit_rand: '30000', crew_driver: '1', crew_helpers: '1',
  fuel_consumption_l_per_100km: '', avg_speed_kmh: '35', max_stops_per_day: '',
  maintenance_cost_per_km: '0',
};

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState([]);
  const [fuelPrices, setFuelPrices] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);

  async function load() {
    const [v, s] = await Promise.all([api.get('/api/vehicles'), api.get('/api/settings')]);
    setVehicles(v);
    setFuelPrices(s.fuelPrices);
  }
  useEffect(() => { load(); }, []);

  // Rank client-side the same way the optimizer does, so what you see here
  // matches what drives route assignment: TRUE cost per km (fuel +
  // maintenance), cheapest first — and cheapest fills first.
  const priceByType = Object.fromEntries(fuelPrices.map((f) => [f.fuel_type, Number(f.price_per_litre)]));
  const ranked = [...vehicles]
    .map((v) => {
      const price = priceByType[v.fuel_type];
      const consumption = Number(v.fuel_consumption_l_per_100km);
      const fuelCostPerKm = price != null ? (consumption / 100) * price : null;
      const costPerKm = fuelCostPerKm != null ? fuelCostPerKm + Number(v.maintenance_cost_per_km || 0) : null;
      return { ...v, fuelCostPerKm, costPerKm };
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
        max_stops_per_day: form.max_stops_per_day === '' ? null : parseInt(form.max_stops_per_day, 10),
        maintenance_cost_per_km: parseFloat(form.maintenance_cost_per_km || '0'),
      });
      setMessage(`${form.name} added.`);
      setForm(emptyForm);
      load();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  }

  async function toggleActive(vehicle) {
    // Send the vehicle's full current field set alongside the toggle —
    // payload_limit_rand is not COALESCE'd server-side (null intentionally
    // clears it back to "unlimited"), so omitting it here would silently
    // wipe the payload cap on every Activate/Deactivate click.
    await api.put(`/api/vehicles/${vehicle.id}`, {
      active: vehicle.active ? 0 : 1,
      name: vehicle.name,
      vehicle_type: vehicle.vehicle_type,
      fuel_type: vehicle.fuel_type,
      payload_limit_rand: vehicle.payload_limit_rand,
      crew_driver: vehicle.crew_driver,
      crew_helpers: vehicle.crew_helpers,
      fuel_consumption_l_per_100km: vehicle.fuel_consumption_l_per_100km,
      avg_speed_kmh: vehicle.avg_speed_kmh,
      max_stops_per_day: vehicle.max_stops_per_day,
      maintenance_cost_per_km: vehicle.maintenance_cost_per_km,
    });
    load();
  }

  function startEdit(vehicle) {
    setEditingId(vehicle.id);
    setEditForm({
      name: vehicle.name,
      vehicle_type: vehicle.vehicle_type,
      fuel_type: vehicle.fuel_type,
      payload_limit_rand: vehicle.payload_limit_rand === null ? '' : String(vehicle.payload_limit_rand),
      crew_driver: String(vehicle.crew_driver),
      crew_helpers: String(vehicle.crew_helpers),
      fuel_consumption_l_per_100km: String(vehicle.fuel_consumption_l_per_100km),
      avg_speed_kmh: String(vehicle.avg_speed_kmh),
      max_stops_per_day: vehicle.max_stops_per_day === null ? '' : String(vehicle.max_stops_per_day),
      maintenance_cost_per_km: String(vehicle.maintenance_cost_per_km ?? 0),
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(emptyForm);
  }

  async function saveEdit(e) {
    e.preventDefault();
    setMessage('Saving...');
    try {
      await api.put(`/api/vehicles/${editingId}`, {
        name: editForm.name,
        vehicle_type: editForm.vehicle_type,
        fuel_type: editForm.fuel_type,
        payload_limit_rand: editForm.payload_limit_rand === '' ? null : parseFloat(editForm.payload_limit_rand),
        crew_driver: parseInt(editForm.crew_driver, 10),
        crew_helpers: parseInt(editForm.crew_helpers, 10),
        fuel_consumption_l_per_100km: parseFloat(editForm.fuel_consumption_l_per_100km),
        avg_speed_kmh: parseFloat(editForm.avg_speed_kmh),
        max_stops_per_day: editForm.max_stops_per_day === '' ? null : parseInt(editForm.max_stops_per_day, 10),
        maintenance_cost_per_km: parseFloat(editForm.maintenance_cost_per_km || '0'),
      });
      setMessage(`${editForm.name} updated.`);
      cancelEdit();
      load();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  }

  return (
    <div className="page">
      <h2>Vehicles</h2>

      <section className="card">
        <h3>Efficiency ranking (best to worst)</h3>
        <p className="hint">
          True cost per km (fuel + maintenance), cheapest first. The route planner fills the CHEAPEST
          vehicle first, up to its own capacity/time limit — an expensive-to-run vehicle is only used
          once the cheaper ones genuinely can't take any more.
        </p>
        <table>
          <thead><tr><th>Rank</th><th>Vehicle</th><th>L/100km</th><th>Fuel R/km</th><th>Maint. R/km</th><th>True R/km</th><th>Payload cap</th><th>Max stops/day</th><th>Active</th></tr></thead>
          <tbody>
            {ranked.map((v, i) => (
              <tr key={v.id}>
                <td>{i + 1}{i === 0 && ' ⭐ most efficient'}{i === ranked.length - 1 && ranked.length > 1 && ' ⛽ least efficient'}</td>
                <td>{v.name}</td>
                <td>{Number(v.fuel_consumption_l_per_100km).toFixed(1)}</td>
                <td>{v.fuelCostPerKm != null ? `R${v.fuelCostPerKm.toFixed(2)}` : '— (no fuel price yet)'}</td>
                <td>R{Number(v.maintenance_cost_per_km || 0).toFixed(2)}</td>
                <td>{v.costPerKm != null ? `R${v.costPerKm.toFixed(2)}` : '—'}</td>
                <td>{v.payload_limit_rand ? `R${Number(v.payload_limit_rand).toLocaleString()}` : 'Unlimited'}</td>
                <td>{v.max_stops_per_day ?? 'No cap'}</td>
                <td>
                  <button onClick={() => toggleActive(v)}>{v.active ? 'Deactivate' : 'Activate'}</button>
                  {' '}
                  <button onClick={() => startEdit(v)}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {editingId && (
        <section className="card">
          <h3>Edit vehicle</h3>
          <form onSubmit={saveEdit}>
            <div className="row">
              <label>Name
                <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
              </label>
              <label>Type
                <select value={editForm.vehicle_type} onChange={(e) => setEditForm({ ...editForm, vehicle_type: e.target.value })}>
                  <option value="van">Van</option>
                  <option value="truck">Truck</option>
                </select>
              </label>
              <label>Fuel
                <select value={editForm.fuel_type} onChange={(e) => setEditForm({ ...editForm, fuel_type: e.target.value })}>
                  <option value="diesel">Diesel</option>
                  <option value="petrol">Petrol</option>
                </select>
              </label>
            </div>
            <div className="row">
              <label>Payload cap (R, blank = unlimited)
                <input type="number" value={editForm.payload_limit_rand} onChange={(e) => setEditForm({ ...editForm, payload_limit_rand: e.target.value })} />
              </label>
              <label>Driver count
                <input type="number" value={editForm.crew_driver} onChange={(e) => setEditForm({ ...editForm, crew_driver: e.target.value })} />
              </label>
              <label>Helper count
                <input type="number" value={editForm.crew_helpers} onChange={(e) => setEditForm({ ...editForm, crew_helpers: e.target.value })} />
              </label>
              <label>Max stops/day (blank = no cap)
                <input type="number" value={editForm.max_stops_per_day} onChange={(e) => setEditForm({ ...editForm, max_stops_per_day: e.target.value })} />
              </label>
            </div>
            <div className="row">
              <label>Fuel consumption (L/100km)
                <input type="number" step="0.1" value={editForm.fuel_consumption_l_per_100km} onChange={(e) => setEditForm({ ...editForm, fuel_consumption_l_per_100km: e.target.value })} required />
              </label>
              <label>Avg speed (km/h)
                <input type="number" value={editForm.avg_speed_kmh} onChange={(e) => setEditForm({ ...editForm, avg_speed_kmh: e.target.value })} />
              </label>
              <label>Maintenance cost (R/km)
                <input type="number" step="0.01" value={editForm.maintenance_cost_per_km} onChange={(e) => setEditForm({ ...editForm, maintenance_cost_per_km: e.target.value })} />
              </label>
            </div>
            <button type="submit">Save changes</button>
            {' '}
            <button type="button" onClick={cancelEdit}>Cancel</button>
          </form>
        </section>
      )}

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
            <label>Max stops/day (blank = no cap)
              <input type="number" value={form.max_stops_per_day} onChange={(e) => setForm({ ...form, max_stops_per_day: e.target.value })} />
            </label>
          </div>
          <div className="row">
            <label>Starting fuel estimate (L/100km)
              <input type="number" step="0.1" value={form.fuel_consumption_l_per_100km} onChange={(e) => setForm({ ...form, fuel_consumption_l_per_100km: e.target.value })} required />
            </label>
            <label>Starting avg speed (km/h)
              <input type="number" value={form.avg_speed_kmh} onChange={(e) => setForm({ ...form, avg_speed_kmh: e.target.value })} />
            </label>
            <label>Maintenance cost (R/km)
              <input type="number" step="0.01" value={form.maintenance_cost_per_km} onChange={(e) => setForm({ ...form, maintenance_cost_per_km: e.target.value })} />
            </label>
          </div>
          <p className="hint">
            Maintenance cost/km: real repair/wear spend for this vehicle ÷ km driven (e.g. a rolling
            year of repair bills ÷ that year's km). Added to fuel cost for the true cost-per-km ranking
            that decides fill order — leave at 0 if you don't track this yet.
          </p>
          <p className="hint">Fuel and speed estimates refine automatically from real fill-ups and trips once the vehicle is in use.</p>
          <button type="submit">Add vehicle</button>
        </form>
        {message && <p className="message">{message}</p>}
      </section>
    </div>
  );
}
