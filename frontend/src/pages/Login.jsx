import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { post } from '../lib/api.js';
import { useAuth } from '../App.jsx';

export default function Login() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const { setUser } = useAuth(); const navigate = useNavigate(); const [params] = useSearchParams();
  async function submit(e) { e.preventDefault(); setBusy(true); setError(''); try { const data = await post('/api/auth/login', form); setUser(data.user); navigate(params.get('next') || '/dashboard'); } catch (err) { setError(err.message); } finally { setBusy(false); } }
  return <div className="login-layout">
    <section className="auth-card"><div className="eyebrow">NexusVCS account</div><h1>Log in</h1><form onSubmit={submit}><label>Email<input type="email" required value={form.email} onChange={e=>setForm({...form,email:e.target.value})} /></label><label>Password<input type="password" required value={form.password} onChange={e=>setForm({...form,password:e.target.value})} /></label>{error && <div className="alert error">{error}</div>}<button className="button primary full" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button></form><p className="form-footer">No account? <Link to="/signup">Create one</Link></p></section>
    <aside className="login-aside">
      <h2>About NexusVCS</h2>
      <p>A lightweight, GitHub-style version-control platform for code and large files. Track repositories, commits, and file history; stage changes and push them when you're ready; lock files to avoid conflicts; and collaborate with others by username — all in a fast, minimal interface.</p>
    </aside>
  </div>;
}
