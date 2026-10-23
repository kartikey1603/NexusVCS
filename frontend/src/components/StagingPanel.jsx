import React, { useState } from 'react';
import { formatBytes } from '../lib/limits.js';

const ACTION_LABELS = { add: 'Added', modify: 'Modified', delete: 'Deleted', restore: 'Restore' };

function ChangeRow({ change, onDiscard, discarding }) {
  const label = change.action === 'restore' ? `Restore → v${change.restoreFromVersion}` : ACTION_LABELS[change.action] || change.action;
  return <li className={`staged-row staged-${change.action}`}>
    <span className={`badge action-${change.action}`}>{label}</span>
    <span className="staged-path" title={change.path}>{change.path}</span>
    {typeof change.size === 'number' && change.size !== null && <span className="muted staged-size">{formatBytes(change.size)}</span>}
    <button type="button" className="button ghost small" disabled={discarding} onClick={() => onDiscard(change._id)}>
      {discarding ? 'Discarding…' : 'Discard'}
    </button>
  </li>;
}

export default function StagingPanel({ staging, canWrite }) {
  const { changes, loading, pushing, discard, push } = staging;
  const [message, setMessage] = useState('');
  const [discardingId, setDiscardingId] = useState(null);
  const [error, setError] = useState('');
  const [lastResult, setLastResult] = useState(null);

  if (!canWrite) return null;

  async function handleDiscard(changeId) {
    setDiscardingId(changeId);
    setError('');
    try { await discard(changeId); } catch (e) { setError(e.message); } finally { setDiscardingId(null); }
  }

  async function handlePush(event) {
    event.preventDefault();
    if (!message.trim() || pushing || !changes.length) return;
    setError('');
    setLastResult(null);
    try {
      const result = await push(message.trim());
      if (result) { setMessage(''); setLastResult(`Pushed ${changes.length} change${changes.length === 1 ? '' : 's'} as one commit.`); }
    } catch (e) {
      setError(e.message);
    }
  }

  return <section className="staging-panel">
    <div className="staging-panel-header">
      <h3>Staged changes {changes.length > 0 && <span className="count-pill">{changes.length}</span>}</h3>
      {loading && <span className="muted">Loading…</span>}
    </div>
    {!loading && changes.length === 0 && <p className="muted">Nothing staged yet. Upload, edit, delete, or restore a file to stage a change here — nothing is committed until you Push.</p>}
    {changes.length > 0 && <ul className="staged-list">
      {changes.map((change) => <ChangeRow key={change._id} change={change} onDiscard={handleDiscard} discarding={discardingId === change._id} />)}
    </ul>}
    <form className="staging-push-form" onSubmit={handlePush}>
      <input type="text" placeholder="Commit message" value={message} onChange={(e) => setMessage(e.target.value)} disabled={pushing || !changes.length} maxLength={200} />
      <button type="submit" className="button primary" disabled={pushing || !changes.length || !message.trim()}>
        {pushing ? 'Pushing…' : `Push${changes.length ? ` ${changes.length} change${changes.length === 1 ? '' : 's'}` : ''}`}
      </button>
    </form>
    {error && <p className="error-text">{error}</p>}
    {lastResult && <p className="success-text">{lastResult}</p>}
  </section>;
}
