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
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleevesnap-scan-history-test-'));
process.env.CACHE_DB_PATH = path.join(scratchDir, 'cache.db');

const { initDb } = await import('../db.js');
const { createAuthMiddleware } = await import('../auth.js');
const { createScanHistoryRouter } = await import('./scanHistory.js');

initDb();

// Two fixed identities so tests can exercise per-user isolation. The
// middleware itself is covered by auth.test.ts.
const USERS: Record<string, { uid: string; email: string }> = {
  'token-a': { uid: 'user-a', email: 'a@example.com' },
  'token-b': { uid: 'user-b', email: 'b@example.com' },
};

const TINY_BASE64_JPEG = Buffer.from('fake-jpeg-bytes').toString('base64');

/** Records puts/deletes in memory so pruning behavior can be asserted on. */
function createFakeStorage(): BlobStorageProvider & { keys: Set<string> } {
  const keys = new Set<string>();
  return {
    keys,
    put: async (key: string) => {
      keys.add(key);
      return `https://blobs.test/${key}`;
    },
    get: async () => null,
    exists: async (key: string) => keys.has(key),
    delete: async (key: string) => {
      keys.delete(key);
    },
  };
}

async function startTestServer(storage: BlobStorageProvider, limit?: number): Promise<{ server: http.Server; port: number }> {
  const app = express();
  app.use(express.json({ limit: '15mb' }));
  app.use(
    '/api/scan-history',
    createAuthMiddleware(async (token) => {
      const user = USERS[token];
      if (!user) throw new Error('unknown token');
      return user;
    }),
    createScanHistoryRouter(storage, limit),
  );

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
  token = 'token-a',
): Promise<{ statusCode: number; json: any }> {
  return await new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string | number> = { authorization: `Bearer ${token}` };
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers,
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

test('POST /api/scan-history creates an entry and stores the captured image', async () => {
  const storage = createFakeStorage();
  const { server, port } = await startTestServer(storage);

  try {
    const res = await requestJson(port, '/api/scan-history', 'POST', {
      capturedImage: TINY_BASE64_JPEG,
      visionGuesses: [{ artist: 'King Gizzard & The Lizard Wizard', title: 'Laminated Denim', confidence: 0.9 }],
      suggestedQuery: 'King Gizzard & The Lizard Wizard Laminated Denim',
    });

    assert.equal(res.statusCode, 201);
    assert.ok(res.json.id);
    assert.ok(res.json.imageUrl);
    assert.deepEqual(res.json.visionGuesses, [
      { artist: 'King Gizzard & The Lizard Wizard', title: 'Laminated Denim', confidence: 0.9 },
    ]);
    assert.deepEqual(res.json.searches, []);
    assert.equal(storage.keys.size, 1);
  } finally {
    await closeServer(server);
  }
});

test('GET /api/scan-history lists entries newest first', async () => {
  const storage = createFakeStorage();
  const { server, port } = await startTestServer(storage);

  try {
    const first = await requestJson(port, '/api/scan-history', 'POST', { capturedImage: TINY_BASE64_JPEG });
    const second = await requestJson(port, '/api/scan-history', 'POST', { capturedImage: TINY_BASE64_JPEG });

    const list = await requestJson(port, '/api/scan-history', 'GET');
    assert.equal(list.statusCode, 200);
    // Other tests in this file share the same scratch DB, so don't assume an
    // exact total count — just that these two are the newest, in order.
    assert.equal(list.json.entries[0].id, second.json.id);
    assert.equal(list.json.entries[1].id, first.json.id);
  } finally {
    await closeServer(server);
  }
});

test('GET /api/scan-history/:id returns 404 for an unknown id', async () => {
  const storage = createFakeStorage();
  const { server, port } = await startTestServer(storage);

  try {
    const res = await requestJson(port, '/api/scan-history/does-not-exist', 'GET');
    assert.equal(res.statusCode, 404);
  } finally {
    await closeServer(server);
  }
});

test('POST /api/scan-history/:id/searches appends a search and GET reflects it', async () => {
  const storage = createFakeStorage();
  const { server, port } = await startTestServer(storage);

  try {
    const created = await requestJson(port, '/api/scan-history', 'POST', { capturedImage: TINY_BASE64_JPEG });
    const id = created.json.id;

    const appended = await requestJson(port, `/api/scan-history/${id}/searches`, 'POST', {
      intent: { title: 'Laminated Denim', artist: 'King Gizzard & The Lizard Wizard' },
      resultGroups: [{ releaseGroupId: 'rg-1', title: 'Laminated Denim', artist: 'King Gizzard & The Lizard Wizard', releaseGroupUrl: 'https://x', availableFormats: ['Vinyl'], totalReleases: 1 }],
    });

    assert.equal(appended.statusCode, 200);
    assert.equal(appended.json.searches.length, 1);
    assert.equal(appended.json.searches[0].intent.title, 'Laminated Denim');
    assert.equal(appended.json.searches[0].resultGroups[0].releaseGroupId, 'rg-1');

    const fetched = await requestJson(port, `/api/scan-history/${id}`, 'GET');
    assert.equal(fetched.json.searches.length, 1);
  } finally {
    await closeServer(server);
  }
});

test('POST /api/scan-history/:id/searches returns 404 for an unknown id', async () => {
  const storage = createFakeStorage();
  const { server, port } = await startTestServer(storage);

  try {
    const res = await requestJson(port, '/api/scan-history/does-not-exist/searches', 'POST', {
      intent: { title: 'x' },
      resultGroups: [],
    });
    assert.equal(res.statusCode, 404);
  } finally {
    await closeServer(server);
  }
});

test('DELETE /api/scan-history/:id removes the row and its stored image', async () => {
  const storage = createFakeStorage();
  const { server, port } = await startTestServer(storage);

  try {
    const created = await requestJson(port, '/api/scan-history', 'POST', { capturedImage: TINY_BASE64_JPEG });
    assert.equal(storage.keys.size, 1);

    const deleted = await requestJson(port, `/api/scan-history/${created.json.id}`, 'DELETE');
    assert.equal(deleted.statusCode, 200);
    assert.equal(storage.keys.size, 0);

    const fetched = await requestJson(port, `/api/scan-history/${created.json.id}`, 'GET');
    assert.equal(fetched.statusCode, 404);
  } finally {
    await closeServer(server);
  }
});

test('DELETE /api/scan-history/:id returns 404 for an unknown id', async () => {
  const storage = createFakeStorage();
  const { server, port } = await startTestServer(storage);

  try {
    const res = await requestJson(port, '/api/scan-history/does-not-exist', 'DELETE');
    assert.equal(res.statusCode, 404);
  } finally {
    await closeServer(server);
  }
});

test("a user's scan history is invisible to other users", async () => {
  const storage = createFakeStorage();
  const { server, port } = await startTestServer(storage);

  try {
    const created = await requestJson(port, '/api/scan-history', 'POST', { capturedImage: TINY_BASE64_JPEG });
    const id = created.json.id;

    const listAsB = await requestJson(port, '/api/scan-history', 'GET', undefined, 'token-b');
    assert.ok(
      !listAsB.json.entries.some((e: any) => e.id === id),
      "user A's scan history entries must not appear in user B's list",
    );

    const fetchAsB = await requestJson(port, `/api/scan-history/${id}`, 'GET', undefined, 'token-b');
    assert.equal(fetchAsB.statusCode, 404, "fetching another user's entry by id must look like it doesn't exist");

    const deleteAsB = await requestJson(port, `/api/scan-history/${id}`, 'DELETE', undefined, 'token-b');
    assert.equal(deleteAsB.statusCode, 404);

    const stillThere = await requestJson(port, `/api/scan-history/${id}`, 'GET');
    assert.equal(stillThere.statusCode, 200, "user B's delete attempt must not remove user A's entry");
  } finally {
    await closeServer(server);
  }
});

test("appending a search to another user's entry is rejected", async () => {
  const storage = createFakeStorage();
  const { server, port } = await startTestServer(storage);

  try {
    const created = await requestJson(port, '/api/scan-history', 'POST', { capturedImage: TINY_BASE64_JPEG });

    const res = await requestJson(
      port,
      `/api/scan-history/${created.json.id}/searches`,
      'POST',
      { intent: { title: 'x' }, resultGroups: [] },
      'token-b',
    );
    assert.equal(res.statusCode, 404);
  } finally {
    await closeServer(server);
  }
});

test("pruning is per-user — one user's new scans never evict another user's history", async () => {
  const storage = createFakeStorage();
  const { server, port } = await startTestServer(storage, 2);

  try {
    const aFirst = await requestJson(port, '/api/scan-history', 'POST', { capturedImage: TINY_BASE64_JPEG });
    const aSecond = await requestJson(port, '/api/scan-history', 'POST', { capturedImage: TINY_BASE64_JPEG });

    // B creating entries must not push A over the limit.
    await requestJson(port, '/api/scan-history', 'POST', { capturedImage: TINY_BASE64_JPEG }, 'token-b');

    const aList = await requestJson(port, '/api/scan-history', 'GET');
    const aIds = aList.json.entries.map((e: any) => e.id);
    assert.ok(aIds.includes(aFirst.json.id), "user B's scan must not evict user A's oldest entry");
    assert.ok(aIds.includes(aSecond.json.id));
  } finally {
    await closeServer(server);
  }
});

test('creating beyond the configured limit prunes the oldest entry and its stored image', async () => {
  const storage = createFakeStorage();
  const { server, port } = await startTestServer(storage, 2);

  try {
    const first = await requestJson(port, '/api/scan-history', 'POST', { capturedImage: TINY_BASE64_JPEG });
    await requestJson(port, '/api/scan-history', 'POST', { capturedImage: TINY_BASE64_JPEG });
    await requestJson(port, '/api/scan-history', 'POST', { capturedImage: TINY_BASE64_JPEG });

    const list = await requestJson(port, '/api/scan-history', 'GET');
    assert.equal(list.json.entries.length, 2, 'only the 2 most recent entries should remain');
    assert.equal(storage.keys.size, 2, 'the pruned entry\'s blob should also be deleted');

    const fetchedOldest = await requestJson(port, `/api/scan-history/${first.json.id}`, 'GET');
    assert.equal(fetchedOldest.statusCode, 404);
  } finally {
    await closeServer(server);
  }
});
