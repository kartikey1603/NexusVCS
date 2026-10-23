import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, get, post } from './lib/api.js';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import Dashboard from './pages/Dashboard.jsx';
import MyRepositories from './pages/MyRepositories.jsx';
import Updates from './pages/Updates.jsx';
import Explore from './pages/Explore.jsx';
import CreateRepository from './pages/CreateRepository.jsx';
import Repository from './pages/Repository.jsx';
import Commits from './pages/Commits.jsx';
import FileView from './pages/FileView.jsx';
import Profile from './pages/Profile.jsx';
import Logo from './components/Logo.jsx';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

function Header() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  async function logout() {
    await post('/api/auth/logout', {});
    await refresh();
    navigate('/');
  }
  return <header className="topbar"><Link className="brand" to="/"><Logo /></Link><nav>
    {user && <Link to="/dashboard">Dashboard</Link>}
    {user && <Link to="/my-repositories">My Repositories</Link>}
    <Link to="/explore">Explore</Link>
    {user && <Link to="/create-repository">Create Repository</Link>}
    {user && <Link to="/updates">Pull / Updates</Link>}
    {user ? <><Link to={`/${user.username}`} className="user-chip">@{user.username}</Link><button className="button ghost" onClick={logout}>Log out</button></> : <><Link to="/login">Log in</Link><Link className="button small" to="/signup">Sign up</Link></>}
  </nav></header>;
}

function Layout() { return <><Header /><main className="app-main"><Outlet /></main><footer className="footer">NexusVCS · lightweight version control for code + large assets</footer></>; }
function RequireAuth({ children }) { const { user, loading } = useAuth(); const location = useLocation(); if (loading) return <div className="loading">Loading…</div>; return user ? children : <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />; }
// Dashboard is the main page once logged in — signed-in visitors to "/" land there instead of the marketing page.
function HomeOrDashboard() { const { user, loading } = useAuth(); if (loading) return <div className="loading">Loading…</div>; return user ? <Navigate to="/dashboard" replace /> : <Home />; }

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => { try { const data = await get('/api/auth/me'); setUser(data.user); } catch { setUser(null); } finally { setLoading(false); } };
  useEffect(() => { refresh(); }, []);
  const value = useMemo(() => ({ user, setUser, refresh, loading }), [user, loading]);
  return <AuthContext.Provider value={value}><Routes>
    <Route element={<Layout />}>
      <Route path="/" element={<HomeOrDashboard />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/explore" element={<Explore />} />
      <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/my-repositories" element={<RequireAuth><MyRepositories /></RequireAuth>} />
      <Route path="/updates" element={<RequireAuth><Updates /></RequireAuth>} />
      <Route path="/create-repository" element={<RequireAuth><CreateRepository /></RequireAuth>} />
      <Route path="/:username" element={<Profile />} />
      <Route path="/:username/:repository" element={<Repository />} />
      <Route path="/:username/:repository/commits" element={<Commits />} />
      <Route path="/:username/:repository/file/*" element={<FileView />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Routes></AuthContext.Provider>;
}
