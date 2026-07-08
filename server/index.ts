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
const PORT = Number(process.env.PORT ?? 3001);
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
  app.get('*', apiLimiter, (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] Listening on http://0.0.0.0:${PORT} (${NODE_ENV})`);
});
