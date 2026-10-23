import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { config } from '../config.js';

export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.nexusvcs_token;
    if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Please log in.' });
    const payload = jwt.verify(token, config.jwtSecret);
    const user = await User.findById(payload.sub).select('-passwordHash');
    if (!user) return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'User no longer exists.' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Please log in.' });
  }
}

export async function optionalAuth(req, res, next) {
  try {
    const token = req.cookies?.nexusvcs_token;
    if (token) {
      const payload = jwt.verify(token, config.jwtSecret);
      req.user = await User.findById(payload.sub).select('-passwordHash');
    }
  } catch {
    req.user = null;
  }
  next();
}
