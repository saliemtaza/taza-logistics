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
  // The server already excludes permanently-failed addresses from this
  // loop (geocode.js's geocode_failed_at check) so it terminates on its
  // own — but a hard iteration cap here is a second, independent safety
  // net: even an unforeseen server-side edge case can't spin this forever
  // and rack up API cost unattended. At 40/batch, 50 iterations covers
  // 2,000 customers — comfortably above any realistic list size.
  const MAX_BATCH_ITERATIONS = 50;

  async function geocodeAllPending() {
    setGeocoding(true);
    const total = pending.length;
    let done = 0;
    setGeocodeProgress({ done, total });
    try {
      for (let i = 0; i < MAX_BATCH_ITERATIONS; i++) {
        const result = await api.post('/api/customers/geocode-batch', {});
        done += (result.succeeded || 0) + (result.failed?.length || 0);
        setGeocodeProgress({ done: Math.min(done, total), total });
        if (!result.stillPending) break;
        if (i === MAX_BATCH_ITERATIONS - 1) {
          alert('Stopped after an unusually large number of batches — check the Failed list below and the server logs before retrying.');
        }
      }
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setGeocoding(false);
      setGeocodeProgress(null);
    }
  }

  // Pending: never attempted (or a previous attempt succeeded then the
  // address changed) — eligible for the auto-batch loop above.
  // Failed: a genuine geocode failure — deliberately excluded from the
  // auto-loop (see geocode.js), only retried one at a time, on purpose.
  const pending = customers.filter((c) => c.lat == null && !c.geocode_failed_at);
  const failed = customers.filter((c) => c.lat == null && c.geocode_failed_at);

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

      {pending.length > 0 && (
        <section className="card">
          <h3>Pending: {pending.length} customer(s) not yet geocoded</h3>
          <button onClick={geocodeAllPending} disabled={geocoding}>
            {geocoding ? 'Geocoding...' : `Geocode all ${pending.length} pending`}
          </button>
          {geocodeProgress && (
            <p className="hint">{geocodeProgress.done} of {geocodeProgress.total} processed...</p>
          )}
          <table>
            <thead><tr><th>Name</th><th>Address</th><th></th></tr></thead>
            <tbody>
              {pending.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td><td>{c.address}</td>
                  <td><button onClick={() => regeocode(c.id)}>Retry</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {failed.length > 0 && (
        <section className="card">
          <h3 className="error">Failed: {failed.length} customer(s) — check the address, then retry individually</h3>
          <p className="hint">
            These addresses couldn't be geocoded and are deliberately left out of "Geocode all pending" above,
            so one bad address can't loop forever and run up API cost. Fix the address if needed, then Retry.
          </p>
          <table>
            <thead><tr><th>Name</th><th>Address</th><th></th></tr></thead>
            <tbody>
              {failed.map((c) => (
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
                <td>{c.lat != null ? '✓ geocoded' : c.geocode_failed_at ? '✗ failed' : 'pending'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
