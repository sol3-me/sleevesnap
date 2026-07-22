import express from 'express';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// db.ts reads CACHE_DB_PATH at module load time, so it must be set before
// the module (and anything that transitively imports it) is loaded.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleevesnap-settings-test-'));
process.env.CACHE_DB_PATH = path.join(scratchDir, 'cache.db');

const { initDb } = await import('../db.js');
const { createAuthMiddleware } = await import('../auth.js');
const { settingsRouter } = await import('./settings.js');

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
    '/api/settings',
    createAuthMiddleware(async (token) => {
      const user = USERS[token];
      if (!user) throw new Error('unknown token');
      return user;
    }),
    settingsRouter,
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
  reqPath: string,
  method: 'GET' | 'PUT',
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
      { hostname: '127.0.0.1', port, path: reqPath, method, headers },
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

test('GET /api/settings returns the default cardSize when no row exists yet', async () => {
  const { server, port } = await startTestServer();
  try {
    const res = await requestJson(port, '/api/settings', 'GET', 'token-a');
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.cardSize, 'M');
  } finally {
    await closeServer(server);
  }
});

test('PUT /api/settings sets cardSize and GET reflects it afterward', async () => {
  const { server, port } = await startTestServer();
  try {
    const put = await requestJson(port, '/api/settings', 'PUT', 'token-a', { cardSize: 'L' });
    assert.equal(put.statusCode, 200);
    assert.equal(put.json.cardSize, 'L');

    const get = await requestJson(port, '/api/settings', 'GET', 'token-a');
    assert.equal(get.statusCode, 200);
    assert.equal(get.json.cardSize, 'L');
  } finally {
    await closeServer(server);
  }
});

test('PUT /api/settings rejects an invalid cardSize value', async () => {
  const { server, port } = await startTestServer();
  try {
    const res = await requestJson(port, '/api/settings', 'PUT', 'token-a', { cardSize: 'XL' });
    assert.equal(res.statusCode, 400);
  } finally {
    await closeServer(server);
  }
});

test("a user's cardSize setting does not affect another user's", async () => {
  const { server, port } = await startTestServer();
  try {
    await requestJson(port, '/api/settings', 'PUT', 'token-a', { cardSize: 'S' });

    const asB = await requestJson(port, '/api/settings', 'GET', 'token-b');
    assert.equal(asB.statusCode, 200);
    assert.equal(asB.json.cardSize, 'M', "user B's setting must stay default after user A changes theirs");
  } finally {
    await closeServer(server);
  }
});

test('GET /api/settings requires auth', async () => {
  const { server, port } = await startTestServer();
  try {
    const res = await requestJson(port, '/api/settings', 'GET', undefined);
    assert.equal(res.statusCode, 401);
  } finally {
    await closeServer(server);
  }
});

test('PUT /api/settings requires auth', async () => {
  const { server, port } = await startTestServer();
  try {
    const res = await requestJson(port, '/api/settings', 'PUT', undefined, { cardSize: 'L' });
    assert.equal(res.statusCode, 401);
  } finally {
    await closeServer(server);
  }
});
