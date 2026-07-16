import rateLimit from 'express-rate-limit';

// General limiter – protects all API routes from abuse
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Generous limiter for static cover art: the landing wall alone loads up
// to 40 images per view, so sharing apiLimiter's 100/min would 429 after a
// few cache-cold refreshes. 600/min absorbs normal browsing (long-lived
// Cache-Control headers keep real traffic far below this) while still
// capping scrapers.
export const coversLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Strict limiter for the scan endpoint (image hashing is CPU-bound)
export const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
