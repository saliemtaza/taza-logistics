import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function CustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [uploadResult, setUploadResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fullSync, setFullSync] = useState(true);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeProgress, setGeocodeProgress] = useState(null); // { done, total }

  async function load() {
    setCustomers(await api.get('/api/customers'));
  }
  useEffect(() => { load(); }, []);

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true);
    setUploadResult(null);
    try {
      const result = await api.upload('/api/customers/upload', file, { full_sync: String(fullSync) });
      setUploadResult(result);
      await load();
    } catch (err) {
      setUploadResult({ error: err.message });
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  async function regeocode(id) {
    try {
      await api.post(`/api/customers/${id}/regeocode`, {});
      await load();
    } catch (err) {
      alert(err.message);
    }
  }

  // Repeatedly calls the batch endpoint (up to 40 customers per call) until
  // nothing's left pending — avoids the operator clicking Retry hundreds
  // of times after a large upload with many not-yet-geocoded addresses.
  async function geocodeAllPending() {
    setGeocoding(true);
    const total = missing.length;
    let done = 0;
    setGeocodeProgress({ done, total });
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await api.post('/api/customers/geocode-batch', {});
        done += (result.succeeded || 0) + (result.failed?.length || 0);
        setGeocodeProgress({ done: Math.min(done, total), total });
        if (!result.stillPending) break;
      }
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setGeocoding(false);
      setGeocodeProgress(null);
    }
  }

  const missing = customers.filter((c) => c.lat == null);

  return (
    <div className="page">
      <h2>Customer database</h2>

      <section className="card">
        <h3>Upload / update customers</h3>
        <p className="hint">CSV with columns: <code>code</code> (optional but recommended — use your accounting system's customer/account number so matching is exact), <code>name</code>, <code>address</code>. Re-uploading the same export is safe and never duplicates rows; only new or changed addresses get re-geocoded.</p>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5em' }}>
          <input type="checkbox" checked={fullSync} onChange={(e) => setFullSync(e.target.checked)} />
          This file is my complete customer list (customers missing from it will be deactivated)
        </label>
        <input type="file" accept=".csv" onChange={handleUpload} disabled={busy} />
        {busy && <p>Uploading &amp; geocoding...</p>}
        {uploadResult && !uploadResult.error && (
          <p className="message">
            {uploadResult.inserted} new, {uploadResult.updated} updated, {uploadResult.skipped} unchanged, {uploadResult.deactivated} deactivated.
            {' '}{uploadResult.geocoded} geocoded.
            {uploadResult.geocodeFailures?.length > 0 && ` ${uploadResult.geocodeFailures.length} failed geocoding.`}
            {uploadResult.deactivationSkipped && ' ⚠ This looked like a partial file (would have deactivated over half your customers), so no one was deactivated — check the file if that’s unexpected.'}
          </p>
        )}
        {uploadResult?.error && <p className="error">{uploadResult.error}</p>}
      </section>

      {missing.length > 0 && (
        <section className="card">
          <h3>Needs attention: {missing.length} customer(s) not geocoded</h3>
          <button onClick={geocodeAllPending} disabled={geocoding}>
            {geocoding ? 'Geocoding...' : `Geocode all ${missing.length} pending`}
          </button>
          {geocodeProgress && (
            <p className="hint">{geocodeProgress.done} of {geocodeProgress.total} processed...</p>
          )}
          <table>
            <thead><tr><th>Name</th><th>Address</th><th></th></tr></thead>
            <tbody>
              {missing.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td><td>{c.address}</td>
                  <td><button onClick={() => regeocode(c.id)}>Retry</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <h3>All customers ({customers.length})</h3>
        <table>
          <thead><tr><th>Code</th><th>Name</th><th>Address</th><th>Status</th></tr></thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td>{c.code}</td><td>{c.name}</td><td>{c.address}</td>
                <td>{c.lat != null ? '✓ geocoded' : 'pending'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
