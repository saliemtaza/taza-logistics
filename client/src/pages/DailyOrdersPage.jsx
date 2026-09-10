import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function DailyOrdersPage() {
  const [date, setDate] = useState(todayStr());
  const [customers, setCustomers] = useState([]);
  const [selected, setSelected] = useState({}); // customer_id -> value_rand string
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/customers').then(setCustomers);
  }, []);

  async function reloadOrders() {
    const orders = await api.get(`/api/orders?date=${date}`);
    const map = {};
    for (const o of orders) map[o.customer_id] = String(o.value_rand);
    setSelected(map);
  }
  useEffect(() => { reloadOrders(); }, [date]);

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true);
    try {
      const result = await api.upload('/api/orders/upload', file, { date });
      setMessage(`Uploaded: ${result.inserted} order(s) matched.${result.notFound.length ? ` ${result.notFound.length} customer(s) not found: ${result.notFound.join(', ')}` : ''} Review below before generating the route.`);
      await reloadOrders();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  function toggle(customerId, checked) {
    setSelected((prev) => {
      const next = { ...prev };
      if (checked) next[customerId] = next[customerId] || '';
      else delete next[customerId];
      return next;
    });
  }

  function setValue(customerId, value) {
    setSelected((prev) => ({ ...prev, [customerId]: value }));
  }

  async function save() {
    const orders = Object.entries(selected)
      .filter(([, v]) => v !== '' && !isNaN(parseFloat(v)))
      .map(([customer_id, value_rand]) => ({ customer_id: parseInt(customer_id, 10), value_rand: parseFloat(value_rand) }));

    if (orders.length === 0) { setMessage('Add at least one order with a value.'); return; }

    setMessage('Saving...');
    const res = await api.post('/api/orders', { date, orders });
    setMessage(`Saved ${res.count} order(s) for ${date}.`);
  }

  // Show already-selected customers regardless of search (so you can review
  // what's on today's list), but hide the rest of the customer base until
  // you actually start typing — with 500 customers, showing everything by
  // default just means scrolling. Matches from the START of the name first
  // (fastest to type), since that's how you'd naturally search.
  const filtered = customers.filter((c) => {
    if (c.id in selected) return true;
    if (search.length === 0) return false;
    return c.name.toLowerCase().startsWith(search.toLowerCase());
  });
  const selectedCount = Object.keys(selected).length;

  return (
    <div className="page">
      <h2>Today's orders</h2>
      <div className="row">
        <label>Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>Upload today's orders (CSV: code/name, value_rand)
          <input type="file" accept=".csv" onChange={handleUpload} disabled={busy} />
        </label>
        <input placeholder="Search customers..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <p className="hint">{selectedCount} customer(s) selected for {date}. This list is your review/confirm step, whether built by upload or by hand — check it before generating the route. Type a customer's name to find them — the full list only appears once you search.</p>

      <table>
        <thead><tr><th></th><th>Customer</th><th>Address</th><th>Order value (R)</th></tr></thead>
        <tbody>
          {filtered.map((c) => (
            <tr key={c.id}>
              <td><input type="checkbox" checked={c.id in selected} onChange={(e) => toggle(c.id, e.target.checked)} /></td>
              <td>{c.name}{c.lat == null && <span className="warn"> (not geocoded)</span>}</td>
              <td>{c.address}</td>
              <td>
                {c.id in selected && (
                  <input type="number" value={selected[c.id]} onChange={(e) => setValue(c.id, e.target.value)} style={{ width: '100px' }} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button onClick={save}>Save order list</button>
      {message && <p className="message">{message}</p>}
    </div>
  );
}
