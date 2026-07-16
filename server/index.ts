import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './db.js';
import { createAuthMiddleware } from './auth.js';
import { createFirebaseVerifier } from './firebaseVerifier.js';
import { collectionRouter } from './routes/collection.js';
import { scanRouter } from './routes/scan.js';
import { searchRouter } from './routes/search.js';
import { createCoversRouter } from './routes/covers.js';
import { createScansRouter } from './routes/scans.js';
import { createScanHistoryRouter } from './routes/scanHistory.js';
import { createLandingRouter } from './routes/landing.js';
import { startLandingWarmup } from './services/landingCovers.js';
import { createStorageProvider } from './storage/index.js';
import { apiLimiter, scanLimiter } from './rateLimiters.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// SERVER_PORT is the backend's own listen port for local dev, where the
// frontend (Vite, always :3000) and this server run as two separate
// processes — vite.config.ts's dev proxy already targets SERVER_PORT.
// PORT is the single-process port used in production/Docker (frontend and
// backend served together); it must NOT double as the local dev backend
// port, or it collides with Vite's hardcoded :3000.
const PORT = Number(process.env.SERVER_PORT ?? process.env.PORT ?? 3001);
const NODE_ENV = process.env.NODE_ENV ?? 'development';

// Core middleware
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// Initialise database
initDb();

// Initialise storage provider
const storage = createStorageProvider();

// Serve locally stored cover art. Deliberately NOT behind auth: cover and
// scan images are loaded via <img> tags, which cannot send Authorization
// headers. Keys are unguessable UUIDs; signed URLs are the future upgrade.
// Deliberately NOT behind apiLimiter either: these are immutable static
// files, and the landing wall legitimately preloads the whole pool (~150
// small thumbnails) on a first visit, which would trip the 100/min API
// budget. Long-lived immutable caching means repeat visits and refreshes
// serve from the browser cache and don't re-request them.
const coversPath = process.env.STORAGE_LOCAL_PATH ?? path.join(process.cwd(), 'data', 'covers');
app.use('/covers', express.static(coversPath, { maxAge: '30d', immutable: true }));

// Every API route requires a signed-in user; verification only needs the
// Firebase project id (no service-account credentials).
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
if (!FIREBASE_PROJECT_ID) {
  console.error(
    '[server] FIREBASE_PROJECT_ID is not set. All API routes require Firebase Authentication — set it in .env to your Firebase project id.',
  );
  process.exit(1);
}
const requireAuth = createAuthMiddleware(createFirebaseVerifier(FIREBASE_PROJECT_ID));

// API routes
app.use('/api/collection', apiLimiter, requireAuth, collectionRouter);
app.use('/api/scan', scanLimiter, requireAuth, scanRouter);
app.use('/api/scans', apiLimiter, requireAuth, createScansRouter(storage));
app.use('/api/scan-history', apiLimiter, requireAuth, createScanHistoryRouter(storage));
app.use('/api/search', apiLimiter, requireAuth, searchRouter);
app.use('/api/covers', apiLimiter, requireAuth, createCoversRouter(storage));

// Deliberately public: the logged-out landing page's cover wall. Serves
// only covers from the curated landing pool (never user data) and lazily
// warms that pool in the background on first hit.
app.use('/api/landing', apiLimiter, createLandingRouter(() => startLandingWarmup(storage)));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// In production serve the built Vite frontend from the same process
if (NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  // Express 5/path-to-regexp rejects bare '*' routes; use middleware fallback instead.
  app.use(apiLimiter, (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] Listening on http://0.0.0.0:${PORT} (${NODE_ENV})`);
});
