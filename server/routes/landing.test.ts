import express from 'express';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// db.ts reads CACHE_DB_PATH at module load time, so it must be set before
// the module (and anything that transitively imports it) is loaded.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleevesnap-landing-test-'));
process.env.CACHE_DB_PATH = path.join(scratchDir, 'cache.db');

const { initDb, db } = await import('../db.js');
const { coverCacheKey } = await import('../services/landingCovers.js');
const { LANDING_POOL } = await import('../services/landingPool.js');
const { createLandingRouter } = await import('./landing.js');

initDb();

function clearCoverCache(): void {
  db.prepare('DELETE FROM cover_cache').run();
}

function seedPoolCovers(count: number): void {
  for (const entry of LANDING_POOL.slice(0, count)) {
    db.prepare(
      'INSERT OR REPLACE INTO cover_cache (cache_key, cover_url, fetched_at) VALUES (?, ?, ?)',
    ).run(coverCacheKey(entry.artist, entry.album), `http://covers/${entry.album}.jpg`, Date.now());
  }
}

async function startTestServer(
  startWarmup: () => void,
): Promise<{ server: http.Server; port: number }> {
  const app = express();
  app.use('/api/landing', createLandingRouter(startWarmup));

  return await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected an ephemeral TCP port');
      }
      resolve({ server, port: address.port });
    });
  });
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function getJson(port: number, requestPath: string): Promise<{ statusCode: number; json: any }> {
  return await new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: requestPath, method: 'GET' },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolve({ statusCode: res.statusCode ?? 0, json: body ? JSON.parse(body) : null }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('GET /api/landing/covers responds 200 without any auth header', async () => {
  clearCoverCache();
  seedPoolCovers(3);
  const { server, port } = await startTestServer(() => {});
  try {
    const { statusCode, json } = await getJson(port, '/api/landing/covers');
    assert.equal(statusCode, 200);
    assert.ok(Array.isArray(json.covers), 'expected a covers array');
  } finally {
    await closeServer(server);
  }
});

test('GET /api/landing/covers returns cached pool covers with url, artist and album', async () => {
  clearCoverCache();
  seedPoolCovers(3);
  const { server, port } = await startTestServer(() => {});
  try {
    const { json } = await getJson(port, '/api/landing/covers');
    assert.equal(json.covers.length, 3);
    const poolAlbums = new Set(LANDING_POOL.map((e) => e.album));
    for (const cover of json.covers) {
      assert.equal(typeof cover.url, 'string');
      assert.ok(poolAlbums.has(cover.album), `unexpected album ${cover.album}`);
      assert.equal(typeof cover.artist, 'string');
    }
  } finally {
    await closeServer(server);
  }
});

test('GET /api/landing/covers honours the count query parameter', async () => {
  clearCoverCache();
  seedPoolCovers(8);
  const { server, port } = await startTestServer(() => {});
  try {
    const { json } = await getJson(port, '/api/landing/covers?count=5');
    assert.equal(json.covers.length, 5);
  } finally {
    await closeServer(server);
  }
});

test('GET /api/landing/covers caps count at the pool size instead of erroring', async () => {
  clearCoverCache();
  seedPoolCovers(4);
  const { server, port } = await startTestServer(() => {});
  try {
    const { statusCode, json } = await getJson(port, '/api/landing/covers?count=9999');
    assert.equal(statusCode, 200);
    assert.equal(json.covers.length, 4);
  } finally {
    await closeServer(server);
  }
});

test('GET /api/landing/covers never exposes cache rows outside the landing pool', async () => {
  clearCoverCache();
  db.prepare(
    'INSERT OR REPLACE INTO cover_cache (cache_key, cover_url, fetched_at) VALUES (?, ?, ?)',
  ).run('someone::private album', 'http://covers/private.jpg', Date.now());
  const { server, port } = await startTestServer(() => {});
  try {
    const { json } = await getJson(port, '/api/landing/covers');
    assert.deepEqual(json.covers, []);
  } finally {
    await closeServer(server);
  }
});

test('GET /api/landing/covers triggers the warmup callback', async () => {
  clearCoverCache();
  let warmupCalls = 0;
  const { server, port } = await startTestServer(() => {
    warmupCalls += 1;
  });
  try {
    await getJson(port, '/api/landing/covers');
    assert.equal(warmupCalls, 1);
  } finally {
    await closeServer(server);
  }
});
