import express from 'express';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { BlobStorageProvider } from '../storage/BlobStorageProvider.js';

// db.ts reads CACHE_DB_PATH at module load time, so it must be set before
// the module (and anything that transitively imports it) is loaded.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleevesnap-scans-test-'));
process.env.CACHE_DB_PATH = path.join(scratchDir, 'cache.db');

const { initDb } = await import('../db.js');
const { createScansRouter } = await import('./scans.js');

initDb();

// Neither test here provides capturedImage or coverUrl, so the storage
// provider is never actually invoked — a stub that throws if called is
// enough to prove that (and keeps this file focused on dedup behavior).
const unusedStorage: BlobStorageProvider = {
  put: () => Promise.reject(new Error('not expected to be called')),
  get: () => Promise.reject(new Error('not expected to be called')),
  exists: () => Promise.reject(new Error('not expected to be called')),
  delete: () => Promise.reject(new Error('not expected to be called')),
};

async function startTestServer(): Promise<{ server: http.Server; port: number }> {
  const app = express();
  app.use(express.json({ limit: '15mb' }));
  app.use('/api/scans', createScansRouter(unusedStorage));

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
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function requestJson(
  port: number,
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<{ statusCode: number; json: any }> {
  return await new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
          : undefined,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          const json = data ? (JSON.parse(data) as unknown) : undefined;
          resolve({ statusCode: res.statusCode ?? 0, json });
        });
      },
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Same real-world case as collection.test.ts, exercised via the Scanner's
// save endpoint instead of Discover's direct-add endpoint — both must agree
// on what counts as "the same record."
test('POST /api/scans allows saving two different pressings (distinct musicBrainzId) of the same artist + title', async () => {
  const { server, port } = await startTestServer();

  try {
    const original = await requestJson(port, '/api/scans', 'POST', {
      artist: 'Queens of the Stone Age',
      title: 'Rated R',
      musicBrainzId: 'mbid-us-2000-original',
    });
    assert.equal(original.statusCode, 201);

    const reissue = await requestJson(port, '/api/scans', 'POST', {
      artist: 'Queens of the Stone Age',
      title: 'Rated R',
      musicBrainzId: 'mbid-2020-reissue',
    });
    assert.equal(
      reissue.statusCode,
      201,
      'a different pressing of the same album (distinct musicBrainzId) must be allowed',
    );
  } finally {
    await closeServer(server);
  }
});

test('POST /api/scans still blocks saving the exact same musicBrainzId twice', async () => {
  const { server, port } = await startTestServer();

  try {
    const first = await requestJson(port, '/api/scans', 'POST', {
      artist: 'Rihanna',
      title: 'Rated R',
      musicBrainzId: 'mbid-rihanna-rated-r',
    });
    assert.equal(first.statusCode, 201);

    const duplicate = await requestJson(port, '/api/scans', 'POST', {
      artist: 'Rihanna',
      title: 'Rated R',
      musicBrainzId: 'mbid-rihanna-rated-r',
    });
    assert.equal(duplicate.statusCode, 409);
  } finally {
    await closeServer(server);
  }
});

test('POST /api/scans falls back to artist + title dedup when neither record has a musicBrainzId', async () => {
  const { server, port } = await startTestServer();

  try {
    const first = await requestJson(port, '/api/scans', 'POST', {
      artist: 'Some Local Band',
      title: 'Self-Released Tape',
    });
    assert.equal(first.statusCode, 201);

    const duplicate = await requestJson(port, '/api/scans', 'POST', {
      artist: 'some local band',
      title: 'self-released tape',
    });
    assert.equal(
      duplicate.statusCode,
      409,
      'without a musicBrainzId on either side, the legacy artist+title guard should still apply',
    );
  } finally {
    await closeServer(server);
  }
});
