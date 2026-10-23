import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
const usernameRe = /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])?$/i;

function issueToken(userId) {
  return jwt.sign({}, config.jwtSecret, { subject: String(userId), expiresIn: '7d' });
}

function setAuthCookie(res, userId) {
  res.cookie('nexusvcs_token', issueToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

router.post('/signup', async (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password || !usernameRe.test(username)) return res.status(400).json({ error: 'INVALID_INPUT', message: 'Use a valid username, email, and password.' });
  if (password.length < 8) return res.status(400).json({ error: 'INVALID_INPUT', message: 'Password must be at least 8 characters.' });
  try {
    const existing = await User.findOne({ $or: [{ username: username.toLowerCase() }, { email: email.toLowerCase() }] });
    if (existing) return res.status(409).json({ error: 'ALREADY_EXISTS', message: 'Username or email is already registered.' });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ username: username.toLowerCase(), email: email.toLowerCase(), passwordHash });
    setAuthCookie(res, user._id);
    res.status(201).json({ user: { id: user._id, username: user.username, email: user.email } });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'ALREADY_EXISTS', message: 'Username or email is already registered.' });
    throw error;
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = await User.findOne({ email: String(email || '').toLowerCase() });
  if (!user || !(await bcrypt.compare(String(password || ''), user.passwordHash))) return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
  setAuthCookie(res, user._id);
  res.json({ user: { id: user._id, username: user.username, email: user.email } });
});

router.post('/logout', (req, res) => {
  res.clearCookie('nexusvcs_token', { httpOnly: true, sameSite: 'lax', secure: config.nodeEnv === 'production' });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: { id: req.user._id, username: req.user.username, email: req.user.email } }));

export default router;
