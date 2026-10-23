import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { get } from '../lib/api.js';
import { useAuth } from '../App.jsx';
import RepoCard from '../components/RepoCard.jsx';
import { readRecentRepos } from '../lib/recent.js';

const FEATURES = [
  'Public & private repositories', 'File & folder management', 'Built-in code editing',
  'Commits & full history', 'Push / Pull / Update', 'Revert to any commit',
  'File version history', 'File locking', 'Collaboration', 'Large-file / S3 support',
];

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [repos, setRepos] = useState([]);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const recent = readRecentRepos();

  useEffect(() => {
    get('/api/repositories').then((d) => setRepos(d.repositories)).catch((e) => setError(e.message));
    get('/api/repositories/stats').then(setStats).catch(() => {}); // stat strip degrades gracefully if this fails
  }, []);

  function submitSearch(e) {
    e.preventDefault();
    navigate(`/my-repositories${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`);
  }

  return <section className="page">
    <div className="page-header">
      <div><div className="eyebrow">Workspace</div><h1>Dashboard</h1><p className="muted">Welcome back, @{user?.username}.</p></div>
      <Link className="button primary" to="/create-repository">+ New Project</Link>
    </div>

    {stats && <div className="stat-strip">
      <div className="stat-item"><span className="stat-value">{stats.repositoryCount}</span><span className="stat-label">Repositories</span></div>
      <div className="stat-item"><span className="stat-value">{stats.commitCount}</span><span className="stat-label">Commits</span></div>
      <div className="stat-item"><span className="stat-value">{stats.pushCount}</span><span className="stat-label">Pushes</span></div>
      <div className="stat-item"><span className="stat-value">{stats.stagedChangeCount}</span><span className="stat-label">Staged changes</span></div>
    </div>}

    <form className="commit-box" style={{ marginBottom: 28, padding: 0, border: 0 }} onSubmit={submitSearch}>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your repositories…" />
      <button className="button">Search</button>
    </form>

    <div className="feature-grid" style={{ marginTop: 0, marginBottom: 36, gridTemplateColumns: 'repeat(4,1fr)' }}>
      <Link className="button full" to="/my-repositories">My Repositories</Link>
      <Link className="button full" to="/create-repository">Create Repository</Link>
      <Link className="button full" to="/explore">Explore</Link>
      <Link className="button full" to="/updates">Pull / Updates</Link>
    </div>

    {error && <div className="alert error">{error}</div>}

    <h2 className="section-title">Recently opened</h2>
    <div className="repo-grid">
      {recent.length ? recent.map((r) => (
        <article className="repo-card" key={`${r.owner}/${r.slug}`}>
          <div className="repo-card-top">
            <Link className="repo-name" to={`/${r.owner}/${r.slug}`}>{r.owner} / {r.name}</Link>
            <span className={`badge ${r.visibility}`}>{r.visibility}</span>
          </div>
          <p className="muted">Opened {new Date(r.visitedAt).toLocaleString()}</p>
          <Link className="text-link" to={`/${r.owner}/${r.slug}`}>Open repository →</Link>
        </article>
      )) : <div className="empty">Repositories you open will show up here for quick access.</div>}
    </div>

    <h2 className="section-title">My Repositories</h2>
    <div className="repo-grid">
      {repos.length ? repos.slice(0, 6).map((r) => <RepoCard key={r._id} repo={r} />) : <div className="empty">No repositories yet. Create your first repository.</div>}
    </div>
    {repos.length > 6 && <p><Link className="text-link" to="/my-repositories">View all {repos.length} repositories →</Link></p>}

    <h2 className="section-title">What NexusVCS does</h2>
    <div className="feature-grid">
      {FEATURES.map((f) => <div key={f}><strong>{f}</strong></div>)}
    </div>
  </section>;
}
