import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './db.js';
import { collectionRouter } from './routes/collection.js';
import { scanRouter } from './routes/scan.js';
import { searchRouter } from './routes/search.js';
import { createCoversRouter } from './routes/covers.js';
import { createScansRouter } from './routes/scans.js';
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

// Serve locally stored cover art
const coversPath = process.env.STORAGE_LOCAL_PATH ?? path.join(process.cwd(), 'data', 'covers');
app.use('/covers', apiLimiter, express.static(coversPath));

// API routes
app.use('/api/collection', apiLimiter, collectionRouter);
app.use('/api/scan', scanLimiter, scanRouter);
app.use('/api/scans', apiLimiter, createScansRouter(storage));
app.use('/api/search', apiLimiter, searchRouter);
app.use('/api/covers', apiLimiter, createCoversRouter(storage));

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
