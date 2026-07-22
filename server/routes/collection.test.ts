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
const { createAuthMiddleware } = await import('../auth.js');
const { collectionRouter } = await import('./collection.js');

initDb();

// Two fixed identities so tests can exercise cross-user isolation. The
// middleware itself is covered by auth.test.ts; here it only exists to
// stamp req.user the way production will.
const USERS: Record<string, { uid: string; email: string }> = {
  'token-a': { uid: 'user-a', email: 'a@example.com' },
  'token-b': { uid: 'user-b', email: 'b@example.com' },
};

async function startTestServer(): Promise<{ server: http.Server; port: number }> {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/collection',
    createAuthMiddleware(async (token) => {
      const user = USERS[token];
      if (!user) throw new Error('unknown token');
      return user;
    }),
    collectionRouter,
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
  token: string | undefined,
  body?: unknown,
): Promise<{ statusCode: number; json: any }> {
  return await new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string | number> = {};
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const req = http.request(
      { hostname: '127.0.0.1', port, path, method, headers },
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
    const original = await requestJson(port, '/api/collection', 'POST', 'token-a', {
      id: 'original-pressing',
      artist: 'Queens of the Stone Age',
      title: 'Rated R',
      musicBrainzId: 'mbid-us-2000-original',
      dateAdded: Date.now(),
    });
    assert.equal(original.statusCode, 201);

    const reissue = await requestJson(port, '/api/collection', 'POST', 'token-a', {
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

test('still blocks adding the exact same musicBrainzId twice for one user', async () => {
  const { server, port } = await startTestServer();

  try {
    const first = await requestJson(port, '/api/collection', 'POST', 'token-a', {
      id: 'first-add',
      artist: 'Rihanna',
      title: 'Rated R',
      musicBrainzId: 'mbid-rihanna-rated-r',
      dateAdded: Date.now(),
    });
    assert.equal(first.statusCode, 201);

    const duplicate = await requestJson(port, '/api/collection', 'POST', 'token-a', {
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
    const first = await requestJson(port, '/api/collection', 'POST', 'token-a', {
      id: 'manual-add-1',
      artist: 'Some Local Band',
      title: 'Self-Released Tape',
      dateAdded: Date.now(),
    });
    assert.equal(first.statusCode, 201);

    const duplicate = await requestJson(port, '/api/collection', 'POST', 'token-a', {
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

// --- Per-user scoping ------------------------------------------------------

test('a user only sees their own records', async () => {
  const { server, port } = await startTestServer();

  try {
    const added = await requestJson(port, '/api/collection', 'POST', 'token-a', {
      id: 'a-private-record',
      artist: 'Boards of Canada',
      title: 'Music Has the Right to Children',
      musicBrainzId: 'mbid-mhtrtc',
      dateAdded: Date.now(),
    });
    assert.equal(added.statusCode, 201);

    const asA = await requestJson(port, '/api/collection', 'GET', 'token-a');
    assert.equal(asA.statusCode, 200);
    assert.ok(
      asA.json.some((r: any) => r.id === 'a-private-record'),
      "user A's own record must appear in their collection",
    );

    const asB = await requestJson(port, '/api/collection', 'GET', 'token-b');
    assert.equal(asB.statusCode, 200);
    assert.ok(
      !asB.json.some((r: any) => r.id === 'a-private-record'),
      "user A's record must not leak into user B's collection",
    );
  } finally {
    await closeServer(server);
  }
});

test('two different users can each own the same pressing', async () => {
  const { server, port } = await startTestServer();

  try {
    const forA = await requestJson(port, '/api/collection', 'POST', 'token-a', {
      id: 'a-copy-of-loveless',
      artist: 'My Bloody Valentine',
      title: 'Loveless',
      musicBrainzId: 'mbid-loveless-1991',
      dateAdded: Date.now(),
    });
    assert.equal(forA.statusCode, 201);

    const forB = await requestJson(port, '/api/collection', 'POST', 'token-b', {
      id: 'b-copy-of-loveless',
      artist: 'My Bloody Valentine',
      title: 'Loveless',
      musicBrainzId: 'mbid-loveless-1991',
      dateAdded: Date.now(),
    });
    assert.equal(
      forB.statusCode,
      201,
      "dedup must be per-user — B owning the same pressing as A is not a duplicate in B's collection",
    );
  } finally {
    await closeServer(server);
  }
});

test("a user cannot delete another user's record", async () => {
  const { server, port } = await startTestServer();

  try {
    const added = await requestJson(port, '/api/collection', 'POST', 'token-a', {
      id: 'a-record-b-wants-gone',
      artist: 'Aphex Twin',
      title: 'Selected Ambient Works 85-92',
      musicBrainzId: 'mbid-saw-85-92',
      dateAdded: Date.now(),
    });
    assert.equal(added.statusCode, 201);

    await requestJson(port, '/api/collection/a-record-b-wants-gone', 'DELETE', 'token-b');

    const asA = await requestJson(port, '/api/collection', 'GET', 'token-a');
    assert.ok(
      asA.json.some((r: any) => r.id === 'a-record-b-wants-gone'),
      "user B's delete must not remove user A's record",
    );
  } finally {
    await closeServer(server);
  }
});

// --- Bulk clear --------------------------------------------------------

test("clearing the collection removes only the authenticated user's records", async () => {
  const { server, port } = await startTestServer();

  try {
    const forA = await requestJson(port, '/api/collection', 'POST', 'token-a', {
      id: 'a-record-to-clear',
      artist: 'Boards of Canada',
      title: 'Geogaddi',
      musicBrainzId: 'mbid-geogaddi',
      dateAdded: Date.now(),
    });
    assert.equal(forA.statusCode, 201);

    const forB = await requestJson(port, '/api/collection', 'POST', 'token-b', {
      id: 'b-record-untouched',
      artist: 'Boards of Canada',
      title: 'Geogaddi',
      musicBrainzId: 'mbid-geogaddi',
      dateAdded: Date.now(),
    });
    assert.equal(forB.statusCode, 201);

    const cleared = await requestJson(port, '/api/collection', 'DELETE', 'token-a');
    assert.equal(cleared.statusCode, 200);

    const asA = await requestJson(port, '/api/collection', 'GET', 'token-a');
    assert.equal(asA.json.length, 0, "clearing user A's collection must remove all of A's records");

    const asB = await requestJson(port, '/api/collection', 'GET', 'token-b');
    assert.ok(
      asB.json.some((r: any) => r.id === 'b-record-untouched'),
      "clearing user A's collection must not touch user B's records",
    );
  } finally {
    await closeServer(server);
  }
});

test('clearing the collection requires auth', async () => {
  const { server, port } = await startTestServer();

  try {
    const res = await requestJson(port, '/api/collection', 'DELETE', undefined);
    assert.equal(res.statusCode, 401);
  } finally {
    await closeServer(server);
  }
});

test('requests without a token are rejected before touching the collection', async () => {
  const { server, port } = await startTestServer();

  try {
    const res = await requestJson(port, '/api/collection', 'GET', undefined);
    assert.equal(res.statusCode, 401);
  } finally {
    await closeServer(server);
  }
});

// --- Bulk import ---------------------------------------------------------

test('POST /api/collection/import adds every new record in one request', async () => {
  const { server, port } = await startTestServer();

  try {
    const res = await requestJson(port, '/api/collection/import', 'POST', 'token-a', {
      records: [
        { id: 'import-1', artist: 'Boards of Canada', title: 'Geogaddi', musicBrainzId: 'mbid-geogaddi', dateAdded: Date.now() },
        { id: 'import-2', artist: 'Aphex Twin', title: 'Selected Ambient Works 85-92', musicBrainzId: 'mbid-saw', dateAdded: Date.now() },
      ],
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.added, 2);
    assert.equal(res.json.duplicates, 0);

    const asA = await requestJson(port, '/api/collection', 'GET', 'token-a');
    assert.ok(asA.json.some((r: any) => r.id === 'import-1'));
    assert.ok(asA.json.some((r: any) => r.id === 'import-2'));
  } finally {
    await closeServer(server);
  }
});

test('POST /api/collection/import skips duplicates and still adds the rest', async () => {
  const { server, port } = await startTestServer();

  try {
    await requestJson(port, '/api/collection', 'POST', 'token-a', {
      id: 'existing',
      artist: 'Rihanna',
      title: 'Rated R',
      musicBrainzId: 'mbid-rihanna-rated-r',
      dateAdded: Date.now(),
    });

    const res = await requestJson(port, '/api/collection/import', 'POST', 'token-a', {
      records: [
        { id: 'dupe-of-existing', artist: 'Rihanna', title: 'Rated R', musicBrainzId: 'mbid-rihanna-rated-r', dateAdded: Date.now() },
        { id: 'import-new', artist: 'Portishead', title: 'Dummy', musicBrainzId: 'mbid-dummy', dateAdded: Date.now() },
      ],
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.added, 1);
    assert.equal(res.json.duplicates, 1);

    const asA = await requestJson(port, '/api/collection', 'GET', 'token-a');
    assert.ok(
      asA.json.some((r: any) => r.id === 'import-new'),
      'the genuinely new import must be added',
    );
    assert.ok(
      !asA.json.some((r: any) => r.id === 'dupe-of-existing'),
      'the duplicate entry must not be inserted under its import id',
    );
  } finally {
    await closeServer(server);
  }
});

test('POST /api/collection/import is scoped to the authenticated user', async () => {
  const { server, port } = await startTestServer();

  try {
    await requestJson(port, '/api/collection/import', 'POST', 'token-a', {
      records: [{ id: 'a-only', artist: 'Slowdive', title: 'Souvlaki', musicBrainzId: 'mbid-souvlaki', dateAdded: Date.now() }],
    });

    const asB = await requestJson(port, '/api/collection', 'GET', 'token-b');
    assert.ok(
      !asB.json.some((r: any) => r.id === 'a-only'),
      "user A's import must not appear in user B's collection",
    );
  } finally {
    await closeServer(server);
  }
});

test('POST /api/collection/import requires auth', async () => {
  const { server, port } = await startTestServer();

  try {
    const res = await requestJson(port, '/api/collection/import', 'POST', undefined, { records: [] });
    assert.equal(res.statusCode, 401);
  } finally {
    await closeServer(server);
  }
});
