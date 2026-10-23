import React, { useEffect, useState } from 'react';
import { get } from '../lib/api.js';
import RepoCard from '../components/RepoCard.jsx';

export default function Explore() {
  const [repos, setRepos] = useState([]); const [error, setError] = useState('');
  useEffect(()=>{get('/api/repositories/public').then(d=>setRepos(d.repositories)).catch(e=>setError(e.message));},[]);
  return <section className="page"><div className="page-header"><div><div className="eyebrow">Public code</div><h1>Explore Repositories</h1><p className="muted">Browse repositories that are explicitly public.</p></div></div>{error && <div className="alert error">{error}</div>}<div className="repo-grid">{repos.length ? repos.map(r=><RepoCard key={r._id} repo={r}/>) : <div className="empty">No public repositories found.</div>}</div></section>;
}
