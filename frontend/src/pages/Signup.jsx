import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { post } from '../lib/api.js';
import { useAuth } from '../App.jsx';

export default function Signup() {
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const { setUser } = useAuth(); const navigate = useNavigate();
  async function submit(e) { e.preventDefault(); setBusy(true); setError(''); try { const data = await post('/api/auth/signup', form); setUser(data.user); navigate('/dashboard'); } catch (err) { setError(err.message); } finally { setBusy(false); } }
  return <section className="auth-card"><div className="eyebrow">Get started</div><h1>Create your account</h1><form onSubmit={submit}><label>Username<input required minLength="3" maxLength="30" pattern="[A-Za-z0-9_\-]+" value={form.username} onChange={e=>setForm({...form,username:e.target.value})} /></label><label>Email<input type="email" required value={form.email} onChange={e=>setForm({...form,email:e.target.value})} /></label><label>Password<input type="password" required minLength="8" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} /></label>{error && <div className="alert error">{error}</div>}<button className="button primary full" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button></form><p className="form-footer">Already registered? <Link to="/login">Log in</Link></p></section>;
}
