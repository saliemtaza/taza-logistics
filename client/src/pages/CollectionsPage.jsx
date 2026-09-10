import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function CollectionsPage() {
  const [date, setDate] = useState(todayStr());
  const [customers, setCustomers] = useState([]);
  const [selected, setSelected] = useState({}); // customer_id -> amount_due_rand string
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/customers').then(setCustomers);
  }, []);

  useEffect(() => {
    api.get(`/api/collections?date=${date}`).then((rows) => {
      const map = {};
      for (const r of rows) map[r.customer_id] = String(r.amount_due_rand);
      setSelected(map);
    });
  }, [date]);

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
    const collections = Object.entries(selected)
      .filter(([, v]) => v !== '' && !isNaN(parseFloat(v)))
      .map(([customer_id, amount_due_rand]) => ({ customer_id: parseInt(customer_id, 10), amount_due_rand: parseFloat(amount_due_rand) }));

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
      for (const r of rows) map[r.customer_id] = String(r.amount_due_rand);
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
  const totalDue = Object.values(selected).reduce((s, v) => s + (parseFloat(v) || 0), 0);

  return (
    <div className="page">
      <h2>Cash collections</h2>
      <p className="hint">
        Customers here don't need an order today — this is purely cash owed that falls on today's
        route. A customer with both a delivery and a collection gets visited once; the driver sees both
        amounts at that stop.
      </p>

      <section className="card">
        <div className="row">
          <label>Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Upload a collections list (CSV: code/name, amount_due_rand)
            <input type="file" accept=".csv" onChange={handleUpload} disabled={busy} />
          </label>
        </div>
        <p className="hint">{selectedCount} customer(s) selected — R{totalDue.toFixed(2)} total due for {date}.</p>

        <input placeholder="Search customers by name..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <table>
          <thead><tr><th></th><th>Customer</th><th>Address</th><th>Amount due (R)</th></tr></thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td><input type="checkbox" checked={c.id in selected} onChange={(e) => toggle(c.id, e.target.checked)} /></td>
                <td>{c.name}</td>
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
        <button onClick={save}>Save collection list</button>
        {message && <p className="message">{message}</p>}
      </section>
    </div>
  );
}
