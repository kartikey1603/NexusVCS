import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../lib/api.js';

export default function Updates() {
  const [repos, setRepos] = useState([]);
  const [error, setError] = useState('');
  const [latest, setLatest] = useState({});
  const [busy, setBusy] = useState({});

  useEffect(() => { get('/api/repositories').then((d) => setRepos(d.repositories)).catch((e) => setError(e.message)); }, []);

  async function pull(repo) {
    setBusy((b) => ({ ...b, [repo._id]: true }));
    try {
      const c = await get(`/api/repositories/${repo._id}/commits`);
      setLatest((l) => ({ ...l, [repo._id]: { ok: true, commit: c.commits[0] || null, at: new Date() } }));
    } catch (e) {
      setLatest((l) => ({ ...l, [repo._id]: { ok: false, message: e.message } }));
    } finally {
      setBusy((b) => ({ ...b, [repo._id]: false }));
    }
  }

  return <section className="page">
    <div className="page-header">
      <div><div className="eyebrow">Sync</div><h1>Pull / Updates</h1><p className="muted">Check every repository for the latest committed state.</p></div>
    </div>
    {error && <div className="alert error">{error}</div>}
    <div className="panel">
      {repos.length ? repos.map((r) => {
        const owner = r.ownerId?.username || 'you';
        const status = latest[r._id];
        return <div className="version-row" key={r._id}>
          <div>
            <strong>{owner} / {r.name}</strong>
            <div className="muted">
              {status ? (status.ok ? (status.commit ? `Latest: "${status.commit.message}" · ${new Date(status.commit.createdAt).toLocaleString()}` : 'No commits yet.') : status.message) : 'Not checked yet.'}
            </div>
          </div>
          <div className="actions" style={{ margin: 0 }}>
            <button className="mini" onClick={() => pull(r)} disabled={busy[r._id]}>{busy[r._id] ? 'Pulling…' : 'Pull latest'}</button>
            <Link className="mini" to={`/${owner}/${r.slug}`}>Open</Link>
          </div>
        </div>;
      }) : <div className="empty">No repositories yet.</div>}
    </div>
  </section>;
}
