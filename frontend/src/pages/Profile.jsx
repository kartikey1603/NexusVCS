import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { del, get } from '../lib/api.js';
import { useAuth } from '../App.jsx';
import RepoCard from '../components/RepoCard.jsx';

export default function Profile() {
  const { username } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const { setUser } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    setData(null);
    setError('');
    get(`/api/users/${username}`).then(setData).catch((e) => setError(e.message));
  }, [username]);

  if (error) return <section className="page"><div className="alert error">{error}</div></section>;
  if (!data) return <div className="loading">Loading profile…</div>;

  const { user, repositories, collaboratingRepositories, stats, isSelf } = data;

  async function handleDeleteAccount() {
    if (!confirm('Permanently delete your account? This deletes every repository you own, along with their commits, files, and staged changes, and cannot be undone.')) return;
    setDeleting(true); setDeleteError('');
    try {
      await del('/api/users/me');
      setUser(null);
      navigate('/');
    } catch (e) { setDeleteError(e.message); setDeleting(false); }
  }

  return <section className="page">
    <div className="page-header">
      <div>
        <div className="eyebrow">{isSelf ? 'Your profile' : 'Public profile'}</div>
        <h1>@{user.username}</h1>
        <p className="muted">Joined {new Date(user.createdAt).toLocaleDateString()} · {stats.publicRepositoryCount} public repositor{stats.publicRepositoryCount === 1 ? 'y' : 'ies'} · {stats.recentCommitCount} commit{stats.recentCommitCount === 1 ? '' : 's'} to public repositories</p>
      </div>
    </div>

    <h2 className="section-title">{isSelf ? 'Repositories' : 'Public repositories'}</h2>
    <div className="repo-grid">
      {repositories.length ? repositories.map((r) => <RepoCard key={r._id} repo={{ ...r, ownerId: { username: user.username } }} />) : <div className="empty">No {isSelf ? '' : 'public '}repositories yet.</div>}
    </div>

    {collaboratingRepositories.length > 0 && <>
      <h2 className="section-title">Collaborates on</h2>
      <div className="repo-grid">
        {collaboratingRepositories.map((r) => <RepoCard key={r._id} repo={r} />)}
      </div>
    </>}

    {isSelf && <div className="panel danger-zone">
      <div className="panel-head"><strong>Danger zone</strong></div>
      <p className="muted">Deleting your account permanently removes repositories you own, along with their commits, files, and staged changes. Repositories you only collaborate on are left untouched.</p>
      {deleteError && <div className="alert error">{deleteError}</div>}
      <button className="button danger" onClick={handleDeleteAccount} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete account'}</button>
    </div>}
  </section>;
}
