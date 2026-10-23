import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App.jsx';
import { post } from '../lib/api.js';

export default function CreateRepository() {
  const [form, setForm] = useState({ name: '', description: '', visibility: 'public' }); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const navigate = useNavigate(); const { user } = useAuth();
  async function submit(e){e.preventDefault(); setBusy(true); setError(''); try { const data = await post('/api/repositories', form); navigate(`/${user.username}/${data.repository.slug}`); } catch(err){setError(err.message);} finally{setBusy(false);}}
  return <section className="form-page"><div className="eyebrow">New repository</div><h1>Create Repository</h1><form className="panel form" onSubmit={submit}><label>Name<input autoFocus required pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,79}" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="MyGame" /></label><label>Description<textarea maxLength="500" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Game development project" /></label><label>Visibility<select value={form.visibility} onChange={e=>setForm({...form,visibility:e.target.value})}><option value="public">Public — anyone can view</option><option value="private">Private — owner only</option></select></label>{error && <div className="alert error">{error}</div>}<div className="actions"><button className="button primary" disabled={busy}>{busy?'Creating…':'Create repository'}</button></div></form></section>;
}
