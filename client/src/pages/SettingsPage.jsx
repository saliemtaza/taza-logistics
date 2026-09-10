import { useEffect, useState } from 'react';
import { api, getApiBase, setApiBase } from '../lib/api.js';

export default function SettingsPage() {
  const [settings, setSettings] = useState({});
  const [fuelPrices, setFuelPrices] = useState([]);
  const [apiBase, setApiBaseInput] = useState(getApiBase());
  const [warehouseAddress, setWarehouseAddress] = useState('');
  const [openTime, setOpenTime] = useState('08:00');
  const [closeTime, setCloseTime] = useState('16:30');
  const [loadMinutes, setLoadMinutes] = useState('20');
  const [newFuelType, setNewFuelType] = useState('diesel');
  const [newFuelPrice, setNewFuelPrice] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const data = await api.get('/api/settings');
    setSettings(data.settings);
    setFuelPrices(data.fuelPrices);
    setWarehouseAddress(data.settings.warehouse_address || '');
    setOpenTime(data.settings.open_time || '08:00');
    setCloseTime(data.settings.close_time || '16:30');
    setLoadMinutes(data.settings.warehouse_load_minutes || '20');
  }
  useEffect(() => { load(); }, []);

  async function saveWarehouse(e) {
    e.preventDefault();
    setMessage('Saving...');
    try {
      const res = await api.put('/api/settings', {
        warehouse_address: warehouseAddress,
        open_time: openTime,
        close_time: closeTime,
        warehouse_load_minutes: loadMinutes,
      });
      setMessage(res.warning || 'Saved.');
      load();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  }

  async function addFuelPrice(e) {
    e.preventDefault();
    await api.post('/api/settings/fuel-price', {
      fuel_type: newFuelType,
      price_per_litre: parseFloat(newFuelPrice),
    });
    setNewFuelPrice('');
    load();
  }

  function saveApiBase(e) {
    e.preventDefault();
    setApiBase(apiBase);
    setMessage('Field devices should use this same address to reach the server.');
  }

  return (
    <div className="page">
      <h2>Settings</h2>

      <section className="card">
        <h3>Warehouse &amp; operating hours</h3>
        <form onSubmit={saveWarehouse}>
          <label>Warehouse address
            <input value={warehouseAddress} onChange={(e) => setWarehouseAddress(e.target.value)} placeholder="e.g. 12 Main Rd, Johannesburg" />
          </label>
          <div className="row">
            <label>Open time
              <input type="time" value={openTime} onChange={(e) => setOpenTime(e.target.value)} />
            </label>
            <label>Close time
              <input type="time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} />
            </label>
            <label>Loading time at warehouse (min)
              <input type="number" value={loadMinutes} onChange={(e) => setLoadMinutes(e.target.value)} />
            </label>
          </div>
          <button type="submit">Save</button>
        </form>
        {settings.warehouse_lat && <p className="hint">Geocoded: {settings.warehouse_lat}, {settings.warehouse_lng}</p>}
      </section>

      <section className="card">
        <h3>Fuel prices</h3>
        <table>
          <thead><tr><th>Fuel</th><th>Price/L</th><th>Effective</th></tr></thead>
          <tbody>
            {fuelPrices.map((f) => (
              <tr key={f.fuel_type}><td>{f.fuel_type}</td><td>R{f.price_per_litre.toFixed(2)}</td><td>{f.effective_date}</td></tr>
            ))}
          </tbody>
        </table>
        <form onSubmit={addFuelPrice} className="row">
          <select value={newFuelType} onChange={(e) => setNewFuelType(e.target.value)}>
            <option value="diesel">Diesel</option>
            <option value="petrol">Petrol</option>
          </select>
          <input type="number" step="0.01" placeholder="Price per litre" value={newFuelPrice} onChange={(e) => setNewFuelPrice(e.target.value)} required />
          <button type="submit">Update price</button>
        </form>
      </section>

      <section className="card">
        <h3>Server address (for field devices)</h3>
        <p className="hint">Phones/tablets in the field must point at this machine's LAN IP, not "localhost". Find it with <code>ipconfig</code> (Windows) or <code>ifconfig</code> (Mac/Linux) on the machine running the server.</p>
        <form onSubmit={saveApiBase} className="row">
          <input value={apiBase} onChange={(e) => setApiBaseInput(e.target.value)} placeholder="http://192.168.1.50:4000" />
          <button type="submit">Save on this device</button>
        </form>
      </section>

      {message && <p className="message">{message}</p>}
    </div>
  );
}
