import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post, put, del } from '../lib/api.js';
import { useAuth } from '../App.jsx';
import { useStagedChanges } from '../lib/staging.js';
import StagingPanel from '../components/StagingPanel.jsx';

export default function FileView() {
  const { username, repository, '*': filePath } = useParams(); const { user } = useAuth();
  const [state, setState] = useState(null); const [versions, setVersions] = useState([]);
  const [preview, setPreview] = useState(''); const [previewAvailable, setPreviewAvailable] = useState(false);
  const [error, setError] = useState(''); const [editing, setEditing] = useState(false); const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false); const [notice, setNotice] = useState(''); const [restoringVersion, setRestoringVersion] = useState(null);
  const staging = useStagedChanges(state?.repo?._id);

  const load = async () => {
    try {
      const repo = await get(`/api/repositories/${username}/${repository}`);
      const file = repo.files.find((f) => f.path === filePath);
      if (!file) throw new Error('File not found');
      const detail = await get(`/api/repositories/${repo.repository._id}/files/${file._id}`);
      const v = await get(`/api/repositories/${repo.repository._id}/files/${file._id}/versions`);
      setState({ ...detail, repo: repo.repository, canWrite: repo.canWrite });
      setVersions(v.versions);
      try {
        const response = await fetch(`/api/repositories/${repo.repository._id}/files/${file._id}/content`, { credentials: 'include' });
        if (response.ok) { const text = await response.text(); setPreview(text); setPreviewAvailable(true); }
        else { setPreview(''); setPreviewAvailable(false); }
      } catch { setPreview(''); setPreviewAvailable(false); }
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); setEditing(false); setNotice(''); }, [username, repository, filePath]);

  if (error) return <section className="page"><div className="alert error">{error}</div></section>;
  if (!state) return <div className="loading">Loading file…</div>;

  const { file, lock, repo, canWrite } = state; const isOwner = Boolean(user) && String(repo.ownerId?._id ?? repo.ownerId) === String(user.id);
  const lockedByOther = Boolean(lock) && String(lock.userId) !== String(user?.id);
  const myStagedChange = staging.changes.find((c) => c.path === file.path);

  async function lockFile() { try { await post(`/api/repositories/${repo._id}/locks`, { filePath: file.path }); await load(); } catch (e) { setNotice(e.message); } }
  async function unlock() { try { await del(`/api/repositories/${repo._id}/locks/${lock._id}`); await load(); } catch (e) { setNotice(e.message); } }
  async function downloadVersion(v) { window.location.href = `/api/repositories/${repo._id}/files/${file._id}/versions/${v.version}/download`; }
  function startEdit() { setEditContent(preview); setNotice(''); setEditing(true); }
  async function saveEdit() {
    setSaving(true); setNotice('');
    try {
      await put(`/api/repositories/${repo._id}/files/${file._id}/content`, { content: editContent });
      setEditing(false);
      setNotice('Staged. Add a commit message below and Push to save this change — nothing is committed yet.');
      await staging.reload();
    } catch (e) { setNotice(e.message); } finally { setSaving(false); }
  }
  async function restoreVersion(v) {
    if (!confirm(`Stage version ${v.version} as the new pending content? This won't take effect until you Push.`)) return;
    setRestoringVersion(v.version); setNotice('');
    try {
      await post(`/api/repositories/${repo._id}/files/${file._id}/versions/${v.version}/restore`, {});
      setNotice(`Staged a restore to version ${v.version}. Push to confirm.`);
      await staging.reload();
    } catch (e) { setNotice(e.message); } finally { setRestoringVersion(null); }
  }

  return <section className="page"><div className="file-header"><div><div className="eyebrow">File</div><h1>{file.path}</h1><p className="muted">{file.size.toLocaleString()} bytes · {file.mimeType} · {file.storageType.toUpperCase()} · v{file.currentVersion}</p></div><Link className="button" to={`/${username}/${repository}`}>← Repository</Link></div><div className="panel detail-grid"><div><span className="label">SHA-256</span><code className="hash">{file.sha256}</code></div><div><span className="label">Lock status</span>{lock ? <span className="lock-label">🔒 Locked by {lock.username}</span> : <span className="available">Available</span>}</div></div>{canWrite && <div className="actions">{!lock && <button className="button primary" onClick={lockFile}>Lock file</button>}{lock && (isOwner || String(lock.userId) === String(user?.id)) && <button className="button" onClick={unlock}>Unlock file</button>}{previewAvailable && !editing && !lockedByOther && <button className="button" onClick={startEdit}>Edit file</button>}</div>}
{myStagedChange && <div className="alert info">You have a staged, unpushed {myStagedChange.action === 'restore' ? `restore to version ${myStagedChange.restoreFromVersion}` : myStagedChange.action} for this file.</div>}
{notice && <div className="alert info">{notice}</div>}
{editing ? <div className="panel preview-panel"><div className="panel-head"><strong>Editing {file.name}</strong></div><textarea className="code-preview" style={{ minHeight: 320, background: '#0b1220', color: '#dbeafe', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: 12, border: 0, borderRadius: 0 }} value={editContent} onChange={(e) => setEditContent(e.target.value)} spellCheck={false} />{editContent !== preview && <div className="muted" style={{ padding: '0 18px 10px' }}>● Unsaved changes</div>}<div className="commit-box"><button className="button primary" onClick={saveEdit} disabled={saving}>{saving ? 'Staging…' : 'Stage change'}</button><button className="button" onClick={() => setEditing(false)} disabled={saving}>Cancel</button></div></div> : (preview && <div className="panel preview-panel"><div className="panel-head"><strong>Current contents</strong></div><pre className="code-preview">{preview}</pre></div>)}
<div className="panel"><div className="panel-head"><strong>Version history</strong></div>{versions.map((v) => <div className="version-row" key={v._id}><div><strong>Version {v.version}</strong><div className="muted">{v.createdBy?.username} · {new Date(v.createdAt).toLocaleString()} · {v.size.toLocaleString()} bytes</div></div><div><button className="mini" onClick={() => downloadVersion(v)}>Download</button>{canWrite && v.version !== file.currentVersion && <button className="mini" onClick={() => restoreVersion(v)} disabled={restoringVersion === v.version}>{restoringVersion === v.version ? 'Staging…' : 'Restore'}</button>}</div></div>)}</div>
{canWrite && <StagingPanel staging={staging} canWrite={canWrite} />}
</section>;
}
