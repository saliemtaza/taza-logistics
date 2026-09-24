import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Unmatched upload rows only ever existed in this page's memory, so a
// refresh made them vanish (and any customer "Placed" from them but never
// saved vanished too). They're now kept per date in localStorage so they
// survive a reload until they're placed or dismissed.
const unmatchedKey = (date) => `taza_unmatched_orders_${date}`;

function loadUnmatched(date) {
  try {
    const raw = localStorage.getItem(unmatchedKey(date));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function storeUnmatched(date, rows) {
  try {
    if (rows.length) localStorage.setItem(unmatchedKey(date), JSON.stringify(rows));
    else localStorage.removeItem(unmatchedKey(date));
  } catch {
    /* storage unavailable — page still works, rows just won't survive a refresh */
  }
}

function buildOrders(selected) {
  return Object.entries(selected)
    .filter(([, v]) => v !== '' && !isNaN(parseFloat(v)))
    .map(([customer_id, value_rand]) => ({ customer_id: parseInt(customer_id, 10), value_rand: parseFloat(value_rand) }));
}

export default function DailyOrdersPage() {
  const [date, setDate] = useState(todayStr());
  const [customers, setCustomers] = useState([]);
  const [selected, setSelected] = useState({}); // customer_id -> value_rand string
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // Rows from the last upload whose code/name didn't match any customer.
  const [unmatched, setUnmatched] = useState([]);
  const [resolveTo, setResolveTo] = useState({}); // unmatched row index -> customer_id string

  useEffect(() => {
    api.get('/api/customers').then(setCustomers);
  }, []);

  async function reloadOrders() {
    const orders = await api.get(`/api/orders?date=${date}`);
    const map = {};
    for (const o of orders) map[o.customer_id] = String(o.value_rand);
    setSelected(map);
  }
  useEffect(() => {
    setUnmatched(loadUnmatched(date));
    setResolveTo({});
    reloadOrders();
  }, [date]);

  function updateUnmatched(rows) {
    setUnmatched(rows);
    storeUnmatched(date, rows);
    setResolveTo({}); // indices shift whenever the list changes
  }

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true);
    try {
      const result = await api.upload('/api/orders/upload', file, { date });
      const notFound = result.notFound || [];
      updateUnmatched(notFound);
      setMessage(`Uploaded: ${result.inserted} order(s) matched.${notFound.length ? ` ${notFound.length} not recognised — resolve them below.` : ''} Review below before generating the route.`);
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

  // Attaches an unmatched upload row's value to a real customer picked
  // manually. Unlike before, this SAVES straight away — placing a row only
  // in page state meant it disappeared on refresh if Save was never pressed.
  async function resolveUnmatched(index) {
    const customerId = resolveTo[index];
    if (!customerId) return;
    const row = unmatched[index];
    const nextSelected = { ...selected, [customerId]: String(row.value_rand) };

    setBusy(true);
    try {
      await api.post('/api/orders', { date, orders: buildOrders(nextSelected) });
      setSelected(nextSelected);
      updateUnmatched(unmatched.filter((_, i) => i !== index));
      setMessage(`Placed "${row.name}" (R${row.value_rand}) and saved the order list.`);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  function dismissUnmatched(index) {
    updateUnmatched(unmatched.filter((_, i) => i !== index));
  }

  async function save() {
    const orders = buildOrders(selected);

    if (orders.length === 0) { setMessage('Add at least one order with a value.'); return; }

    setMessage('Saving...');
    const res = await api.post('/api/orders', { date, orders });
    const outstanding = unmatched.length
      ? ` Warning: ${unmatched.length} uploaded row(s) are still unmatched and NOT in this list (R${unmatched.reduce((s, r) => s + Number(r.value_rand || 0), 0)}).`
      : '';
    setMessage(`Saved ${res.count} order(s) for ${date}.${outstanding}`);
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

  // Selected orders whose customer isn't in the customers list at all
  // (e.g. inactive/filtered out) — they count in the total but have no row
  // to show, which is how "26 selected" can sit above 25 visible rows.
  const knownIds = new Set(customers.map((c) => String(c.id)));
  const hiddenSelected = customers.length
    ? Object.keys(selected).filter((id) => !knownIds.has(String(id)))
    : [];

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

      {hiddenSelected.length > 0 && (
        <p className="warn">
          {hiddenSelected.length} selected order(s) belong to customer id(s) {hiddenSelected.join(', ')}, which
          aren't in the customer list above, so they have no row here (they will still be routed).
        </p>
      )}

      {unmatched.length > 0 && (
        <section className="card">
          <h3 className="error">Not recognised from upload ({unmatched.length})</h3>
          <p className="hint">
            These didn't match any customer by code or name — could be a typo, an old name, or a
            genuinely new customer not in the database yet. Match to the correct customer below (it
            saves the order list straight away), or dismiss. These stay here after a refresh until
            you place or dismiss them.
          </p>
          <table>
            <thead><tr><th>From CSV</th><th>Value (R)</th><th>Match to customer</th><th></th></tr></thead>
            <tbody>
              {unmatched.map((row, i) => (
                <tr key={i}>
                  <td>{row.name}</td>
                  <td>R{row.value_rand}</td>
                  <td>
                    <select value={resolveTo[i] || ''} onChange={(e) => setResolveTo((prev) => ({ ...prev, [i]: e.target.value }))}>
                      <option value="">— select customer —</option>
                      {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <button onClick={() => resolveUnmatched(i)} disabled={!resolveTo[i] || busy}>Place</button>
                    {' '}
                    <button onClick={() => dismissUnmatched(i)} disabled={busy}>Dismiss</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

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
