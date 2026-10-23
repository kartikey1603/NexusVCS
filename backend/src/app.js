import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { config } from './config.js';
import { securityHeaders, rateLimit } from './middleware/security.js';
import authRoutes from './routes/auth.js';
import repositoryRoutes from './routes/repositories.js';
import lockRoutes from './routes/locks.js';
import s3Routes from './routes/s3.js';
import userRoutes from './routes/users.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(cors({ origin: config.frontendUrl, credentials: true }));
// Small-file uploads travel as base64 inside the JSON body (~4/3 the raw byte size), so the
// parser limit must cover the threshold's base64 inflation plus headroom for the rest of the
// payload -- not just the raw threshold itself.
const jsonBodyLimitMb = Math.max(16, Math.ceil((config.largeFileThresholdBytes * 4) / 3 / (1024 * 1024)) + 5);
app.use(express.json({ limit: `${jsonBodyLimitMb}mb` }));
app.use(cookieParser());

// Sensitive auth endpoints get a tighter rate limit to blunt credential-stuffing/brute-force attempts.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: 'Too many authentication attempts. Please try again in a few minutes.' });

app.get('/health', (_req, res) => res.json({ ok: true, service: 'nexusvcs-backend' }));
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/repositories', lockRoutes);
app.use('/api/repositories', repositoryRoutes);
app.use('/api/s3', s3Routes);
app.use('/api/users', userRoutes);

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' });
});

export default app;
