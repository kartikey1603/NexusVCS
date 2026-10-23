// Lightweight, dependency-free security middleware. Kept intentionally small: this is a
// college-project deployment, not an enterprise app, so we add the basics (safe headers,
// a simple rate limit on auth endpoints) rather than pulling in helmet/express-rate-limit.

export function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  next();
}

// In-memory fixed-window rate limiter. Good enough for a single-instance deployment; the
// window resets automatically and never stores anything beyond a request count per IP.
export function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (entry.count >= max) {
      return res.status(429).json({ error: 'RATE_LIMITED', message: message || 'Too many requests. Please try again later.' });
    }
    entry.count += 1;
    next();
  };
}
