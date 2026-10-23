import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get } from '../lib/api.js';
import RepoCard from '../components/RepoCard.jsx';

export default function MyRepositories() {
  const [repos, setRepos] = useState([]);
  const [error, setError] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') || '';

  useEffect(() => { get('/api/repositories').then((d) => setRepos(d.repositories)).catch((e) => setError(e.message)); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => r.name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q));
  }, [repos, query]);

  return <section className="page">
    <div className="page-header">
      <div><div className="eyebrow">Workspace</div><h1>My Repositories</h1><p className="muted">Your public and private NexusVCS repositories, and ones you collaborate on.</p></div>
      <Link className="button primary" to="/create-repository">+ Create Repository</Link>
    </div>
    <form className="commit-box" style={{ marginBottom: 24, padding: 0, border: 0 }} onSubmit={(e) => e.preventDefault()}>
      <input value={query} onChange={(e) => setSearchParams(e.target.value ? { q: e.target.value } : {})} placeholder="Search by name or description…" />
    </form>
    {error && <div className="alert error">{error}</div>}
    <div className="repo-grid">
      {filtered.length ? filtered.map((r) => <RepoCard key={r._id} repo={r} />) : <div className="empty">{repos.length ? 'No repositories match your search.' : 'No repositories yet. Create your first repository.'}</div>}
    </div>
  </section>;
}
