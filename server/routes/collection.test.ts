import express from 'express';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// db.ts reads CACHE_DB_PATH at module load time, so it must be set before
// the module (and anything that transitively imports it) is loaded.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleevesnap-collection-test-'));
process.env.CACHE_DB_PATH = path.join(scratchDir, 'cache.db');

const { initDb } = await import('../db.js');
const { collectionRouter } = await import('./collection.js');

initDb();

async function startTestServer(): Promise<{ server: http.Server; port: number }> {
  const app = express();
  app.use(express.json());
  app.use('/api/collection', collectionRouter);

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
  method: 'GET' | 'POST' | 'DELETE',
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

// Real-world case that motivated this: a collector owns both the original
// 2000 US pressing and a 2020 reissue of the same album ("Rated R" by Queens
// of the Stone Age) — two distinct MusicBrainz releases sharing one title.
// The old artist+title-only dedup made it impossible to store both.
test('allows adding two different pressings (distinct musicBrainzId) of the same artist + title', async () => {
  const { server, port } = await startTestServer();

  try {
    const original = await requestJson(port, '/api/collection', 'POST', {
      id: 'original-pressing',
      artist: 'Queens of the Stone Age',
      title: 'Rated R',
      musicBrainzId: 'mbid-us-2000-original',
      dateAdded: Date.now(),
    });
    assert.equal(original.statusCode, 201);

    const reissue = await requestJson(port, '/api/collection', 'POST', {
      id: 'reissue-pressing',
      artist: 'Queens of the Stone Age',
      title: 'Rated R',
      musicBrainzId: 'mbid-2020-reissue',
      dateAdded: Date.now(),
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

test('still blocks adding the exact same musicBrainzId twice', async () => {
  const { server, port } = await startTestServer();

  try {
    const first = await requestJson(port, '/api/collection', 'POST', {
      id: 'first-add',
      artist: 'Rihanna',
      title: 'Rated R',
      musicBrainzId: 'mbid-rihanna-rated-r',
      dateAdded: Date.now(),
    });
    assert.equal(first.statusCode, 201);

    const duplicate = await requestJson(port, '/api/collection', 'POST', {
      id: 'second-add-same-pressing',
      artist: 'Rihanna',
      title: 'Rated R',
      musicBrainzId: 'mbid-rihanna-rated-r',
      dateAdded: Date.now(),
    });
    assert.equal(duplicate.statusCode, 409);
  } finally {
    await closeServer(server);
  }
});

test('falls back to artist + title dedup when neither record has a musicBrainzId', async () => {
  const { server, port } = await startTestServer();

  try {
    const first = await requestJson(port, '/api/collection', 'POST', {
      id: 'manual-add-1',
      artist: 'Some Local Band',
      title: 'Self-Released Tape',
      dateAdded: Date.now(),
    });
    assert.equal(first.statusCode, 201);

    const duplicate = await requestJson(port, '/api/collection', 'POST', {
      id: 'manual-add-2',
      artist: 'some local band',
      title: 'self-released tape',
      dateAdded: Date.now(),
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
