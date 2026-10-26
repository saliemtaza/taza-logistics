import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { isOutsideGauteng, NOT_IN_GAUTENG_LABEL } from '../lib/geo.js';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function CollectionsPage() {
  const [date, setDate] = useState(todayStr());
  const [customers, setCustomers] = useState([]);
  // customer_id -> true. Only WHICH customers have a collection today matters —
  // the collection is there to fit the stop into the route, so no amount is
  // captured (it's stored as 0).
  const [selected, setSelected] = useState({});
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/customers').then(setCustomers);
  }, []);

  useEffect(() => {
    api.get(`/api/collections?date=${date}`).then((rows) => {
      const map = {};
      for (const r of rows) map[r.customer_id] = true;
      setSelected(map);
    });
  }, [date]);

  function toggle(customerId, checked) {
    setSelected((prev) => {
      const next = { ...prev };
      if (checked) next[customerId] = true;
      else delete next[customerId];
      return next;
    });
  }

  async function save() {
    const collections = Object.keys(selected)
      .map((customer_id) => ({ customer_id: parseInt(customer_id, 10), amount_due_rand: 0 }));

    setMessage('Saving...');
    const res = await api.post('/api/collections', { date, collections });
    setMessage(`Saved ${res.count} collection(s) for ${date}.`);
  }

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true);
    try {
      const result = await api.upload('/api/collections/upload', file, { date });
      setMessage(`Uploaded: ${result.inserted} collection(s) matched.${result.notFound.length ? ` ${result.notFound.length} customer(s) not found: ${result.notFound.join(', ')}` : ''}`);
      const rows = await api.get(`/api/collections?date=${date}`);
      const map = {};
      for (const r of rows) map[r.customer_id] = true;
      setSelected(map);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  // Same as Daily Orders: show what's already selected regardless of search,
  // hide the rest of the customer base until you start typing, and match
  // from the start of the name — fastest to find someone in a 500-customer
  // list without scrolling.
  const filtered = customers.filter((c) => {
    if (c.id in selected) return true;
    if (search.length === 0) return false;
    return c.name.toLowerCase().startsWith(search.toLowerCase());
  });
  const selectedCount = Object.keys(selected).length;

  return (
    <div className="page">
      <h2>Cash collections</h2>
      <p className="hint">
        Customers here don't need an order today — ticking one just adds a cash-collection stop to
        today's route. No amount is needed; the collection is only here so the stop gets fitted into the
        route. A customer with both a delivery and a collection gets visited once.
      </p>

      <section className="card">
        <div className="row">
          <label>Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Upload a collections list (CSV: code or name — no amount needed)
            <input type="file" accept=".csv" onChange={handleUpload} disabled={busy} />
          </label>
        </div>
        <p className="hint">{selectedCount} customer(s) with a cash collection on {date}.</p>

        <input placeholder="Search customers by name..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <table>
          <thead><tr><th></th><th>Customer</th><th>Address</th></tr></thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td><input type="checkbox" checked={c.id in selected} onChange={(e) => toggle(c.id, e.target.checked)} /></td>
                <td>{c.name}{c.lat == null && <span className="warn"> (not geocoded)</span>}</td>
                <td>{c.address}{isOutsideGauteng(c.lat, c.lng) && <span className="warn"> {NOT_IN_GAUTENG_LABEL}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={save}>Save collection list</button>
        {message && <p className="message">{message}</p>}
      </section>
    </div>
  );
}
