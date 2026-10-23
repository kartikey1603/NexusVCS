import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { del, get, post } from '../lib/api.js';
import { useAuth } from '../App.jsx';
import { trackRecentRepo } from '../lib/recent.js';
import { formatBytes } from '../lib/limits.js';
import { uploadFileToRepo } from '../lib/upload.js';
import { useStagedChanges } from '../lib/staging.js';
import StagingPanel from '../components/StagingPanel.jsx';

// Merges real files with the current user's staged changes into one tree: a file that only
// exists as a pending "add" (nothing pushed yet) still needs a row, marked pendingOnly since
// there is no real File document to lock/download/version yet.
function rows(files, stagedByPath) {
  const map = new Map();
  function insert(path, itemMeta) {
    const parts = path.split('/');
    let node = map;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!node.has(part)) node.set(part, { name: part, path: parts.slice(0, i + 1).join('/'), folder: i < parts.length - 1, file: i === parts.length - 1, children: new Map(), item: i === parts.length - 1 ? itemMeta : null });
      node = node.get(part).children;
    }
  }
  for (const f of files) insert(f.path, { ...f, staged: stagedByPath.get(f.path) || null, pendingOnly: false });
  for (const change of stagedByPath.values()) {
    if (change.action === 'add' && !files.some((f) => f.path === change.path)) {
      insert(change.path, { _id: `staged-${change._id}`, path: change.path, name: change.name, size: change.size, mimeType: change.mimeType, storageType: change.storageType, staged: change, pendingOnly: true });
    }
  }
  return map;
}

export default function Repository() {
  const { username, repository } = useParams(); const { user } = useAuth(); const navigate = useNavigate();
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); const [uploadStatus, setUploadStatus] = useState('');
  const [notice, setNotice] = useState(''); const [pulling, setPulling] = useState(false);
  const [collabName, setCollabName] = useState(''); const [collabBusy, setCollabBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const staging = useStagedChanges(data?.repository?._id);

  // Pull never touches staged changes -- they live in their own collection, scoped to this
  // user, and are only ever cleared by a successful Push.
  const load = () => get(`/api/repositories/${username}/${repository}`).then((d) => { setData(d); trackRecentRepo(d.repository); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [username, repository]);

  const stagedByPath = useMemo(() => new Map(staging.changes.map((c) => [c.path, c])), [staging.changes]);
  const tree = useMemo(() => (data ? rows(data.files, stagedByPath) : new Map()), [data, stagedByPath]);

  if (error) return <section className="page"><div className="alert error">{error}</div></section>;
  if (!data) return <div className="loading">Loading repository…</div>;

  const repo = data.repository; const locks = new Map(data.locks.map((l) => [l.filePath, l])); const canWrite = data.canWrite; const isOwner = data.isOwner;

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const path = prompt('Repository path', file.name);
    if (!path) { e.target.value = ''; return; }
    setUploading(true); setNotice(''); setUploadProgress(0); setUploadStatus('');
    try {
      await uploadFileToRepo({ repositoryId: repo._id, file, path, onProgress: setUploadProgress, onStatus: setUploadStatus });
      setNotice(`"${path}" staged. Add a commit message below and Push to save it — nothing is committed yet.`);
      await staging.reload();
    } catch (err) {
      setNotice(err.message);
    } finally {
      setUploading(false); setUploadProgress(null); setUploadStatus(''); e.target.value = '';
    }
  }
  async function deleteFile(file) {
    if (!confirm(`Stage deletion of "${file.path}"? This won't take effect until you Push.`)) return;
    setNotice('');
    try { await post(`/api/repositories/${repo._id}/files/${file._id}/delete`, {}); setNotice(`Staged deletion of "${file.path}". Push to confirm.`); await staging.reload(); }
    catch (e) { setNotice(e.message); }
  }
  async function discardChange(changeId) {
    try { await staging.discard(changeId); setNotice('Discarded staged change.'); }
    catch (e) { setNotice(e.message); }
  }
  async function pull() { setPulling(true); setNotice(''); try { await load(); setNotice('Pulled the latest repository state.'); } catch (e) { setNotice(e.message); } finally { setPulling(false); } }
  async function lock(path) { try { await post(`/api/repositories/${repo._id}/locks`, { filePath: path }); setNotice(`Locked ${path}.`); await load(); } catch (e) { setNotice(e.message); } }
  async function unlock(l) { try { await del(`/api/repositories/${repo._id}/locks/${l._id}`); setNotice(`Unlocked ${l.filePath}.`); await load(); } catch (e) { setNotice(e.message); } }
  async function download(file) { window.location.href = `/api/repositories/${repo._id}/files/${file._id}/download`; }
  async function addCollaborator(e) { e.preventDefault(); if (!collabName.trim()) return; setCollabBusy(true); setNotice(''); try { await post(`/api/repositories/${repo._id}/collaborators`, { username: collabName.trim() }); setCollabName(''); setNotice('Collaborator added.'); await load(); } catch (e) { setNotice(e.message); } finally { setCollabBusy(false); } }
  async function removeCollaborator(c) { try { await del(`/api/repositories/${repo._id}/collaborators/${c._id}`); setNotice(`Removed @${c.userId?.username}.`); await load(); } catch (e) { setNotice(e.message); } }
  async function deleteRepo() {
    if (!confirm(`Permanently delete "${repo.name}"? This cannot be undone.`)) return;
    setDeleting(true); setNotice('');
    try { await del(`/api/repositories/${repo._id}`); navigate('/dashboard'); }
    catch (e) { setNotice(e.message); setDeleting(false); }
  }

  const render = (map, depth = 0) => [...map.values()].map((n) => {
    if (n.folder) return <div key={n.path} className="tree-folder" style={{ marginLeft: depth * 18 }}><span>▾ {n.name}/</span>{render(n.children, depth + 1)}</div>;
    const item = n.item; const staged = item.staged; const lockInfo = locks.get(n.path);
    const stagedLabel = staged ? (staged.action === 'restore' ? `staged: restore → v${staged.restoreFromVersion}` : `staged: ${staged.action}`) : null;
    return <div key={n.path} className={`file-row${staged ? ' file-row-staged' : ''}`} style={{ marginLeft: depth * 18 }}>
      {item.pendingOnly ? <span className="file-link file-link-pending">{n.name}</span> : <Link to={`/${username}/${repository}/file/${n.path}`} className="file-link">{n.name}</Link>}
      {!item.pendingOnly && <span className="file-meta">{formatBytes(item.size)} · {item.storageType.toUpperCase()}</span>}
      {stagedLabel && <span className={`badge action-${staged.action}`}>{stagedLabel}</span>}
      {lockInfo && <span className="lock-label">🔒 {lockInfo.username}</span>}
      {canWrite && !item.pendingOnly && !lockInfo && <button className="mini" onClick={() => lock(n.path)}>Lock</button>}
      {canWrite && lockInfo && (isOwner || String(lockInfo.userId) === String(user?.id)) && <button className="mini" onClick={() => unlock(lockInfo)}>Unlock</button>}
      {!item.pendingOnly && <button className="mini" onClick={() => download(item)}>Download</button>}
      {canWrite && staged && <button className="mini" onClick={() => discardChange(staged._id)}>Discard</button>}
      {canWrite && !item.pendingOnly && staged?.action !== 'delete' && <button className="mini danger" onClick={() => deleteFile(item)}>Delete</button>}
    </div>;
  });

  return <section className="page">
    <div className="repo-header">
      <div><div className="eyebrow">Repository</div><h1><Link to={`/${username}`}>{username}</Link> / {repo.name}</h1><p>{repo.description || 'No description.'}</p></div>
      <div className="repo-actions"><span className={`badge ${repo.visibility}`}>{repo.visibility}</span>{data.role && data.role !== 'visitor' && <span className="badge role">{data.role}</span>}<button className="button" onClick={pull} disabled={pulling}>{pulling ? 'Pulling…' : 'Pull'}</button><Link className="button" to={`/${username}/${repository}/commits`}>Commits</Link>{isOwner && <button className="button danger" onClick={deleteRepo} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete repository'}</button>}</div>
    </div>
    <div className="panel file-panel">
      <div className="panel-head"><strong>Files</strong>{canWrite && <label className="button small">{uploading ? 'Uploading…' : 'Upload file'}<input hidden type="file" onChange={handleUpload} disabled={uploading} /></label>}</div>
      {uploading && <div className="upload-progress"><div className="upload-progress-track"><div className="upload-progress-bar" style={{ width: `${Math.round((uploadProgress || 0) * 100)}%` }} /></div><span className="muted">{uploadStatus}</span></div>}
      <div className="tree">{render(tree)}</div>
      {!data.files.length && !staging.changes.length && <div className="empty">This repository is empty.</div>}
    </div>
    {canWrite && <StagingPanel staging={staging} canWrite={canWrite} />}
    {isOwner && <div className="panel collab-panel">
      <div className="panel-head"><strong>Collaborators</strong></div>
      <form className="commit-box" onSubmit={addCollaborator}><input value={collabName} onChange={(e) => setCollabName(e.target.value)} placeholder="Username to add" /><button className="button" disabled={collabBusy}>{collabBusy ? 'Adding…' : 'Add collaborator'}</button></form>
      {data.collaborators?.length ? data.collaborators.map((c) => <div className="version-row" key={c._id}><div><strong>@{c.userId?.username}</strong><div className="muted">Added {new Date(c.createdAt).toLocaleDateString()}</div></div><button className="mini" onClick={() => removeCollaborator(c)}>Remove</button></div>) : <div className="empty">No collaborators yet. Add someone by username to give them push, commit, and lock access.</div>}
    </div>}
    {notice && <div className="alert info">{notice}</div>}
  </section>;
}
