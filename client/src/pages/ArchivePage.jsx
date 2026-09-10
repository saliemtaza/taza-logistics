import { useEffect, useState } from 'react';
import { api, getApiBase } from '../lib/api.js';

function defaultCutoff() {
  const d = new Date();
  d.setDate(d.getDate() - 60); // 60-day retention default
  return d.toISOString().slice(0, 10);
}

export default function ArchivePage() {
  const [before, setBefore] = useState(defaultCutoff());
  const [preview, setPreview] = useState(null);
  const [files, setFiles] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadFiles() {
    setFiles(await api.get('/api/archive/files'));
  }
  useEffect(() => { loadFiles(); }, []);

  async function checkPreview() {
    setPreview(await api.get(`/api/archive/preview?before=${before}`));
  }

  async function runIt() {
    setBusy(true);
    setMessage('Archiving...');
    try {
      const result = await api.post('/api/archive/run', { before });
      setMessage(`Archived ${result.archived} completed trip(s) into ${result.files.length} file(s).`);
      setPreview(null);
      loadFiles();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h2>History / Archive</h2>
      <p className="hint">
        The learning model doesn't need raw trip history — vehicle speed, dwell time, and fuel
        consumption are already stored as running averages that update as each trip completes.
        Raw trip history is kept only for your own record-keeping, so it's safe to move anything
        older than a cutoff out of the live database and into cheap archive files. Once on Supabase,
        these files live in Storage instead of local disk — nothing else about the app changes.
      </p>

      <section className="card">
        <h3>Archive old trips</h3>
        <div className="row">
          <label>Archive everything completed before
            <input type="date" value={before} onChange={(e) => { setBefore(e.target.value); setPreview(null); }} />
          </label>
          <button onClick={checkPreview}>Preview</button>
        </div>

        {preview && (
          preview.tripCount === 0
            ? <p className="hint">Nothing to archive before {before}.</p>
            : <>
                <p className="hint">
                  Would archive {preview.tripCount} trip(s), from {preview.earliestDate} to {preview.latestDate}.
                </p>
                <button onClick={runIt} disabled={busy}>Archive now</button>
              </>
        )}
        {message && <p className="message">{message}</p>}
      </section>

      <section className="card">
        <h3>Archive files ({files.length})</h3>
        <table>
          <thead><tr><th>File</th><th>Size</th><th></th></tr></thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.name}>
                <td>{f.name}</td>
                <td>{(f.sizeBytes / 1024).toFixed(1)} KB</td>
                <td><a href={`${getApiBase()}/api/archive/files/${f.name}`} target="_blank" rel="noreferrer">Download</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
