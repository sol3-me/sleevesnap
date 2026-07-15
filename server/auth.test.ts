import express from 'express';
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';

import { createAuthMiddleware, type TokenVerifier } from './auth.js';

// A verifier that only accepts the literal token "valid-token" — the tests
// exercise the middleware's HTTP behaviour, not Firebase itself. The real
// firebase-admin verifier is wired up in index.ts and is deliberately not
// under test here (it's Google's code).
const fakeVerifier: TokenVerifier = async (token) => {
  if (token === 'valid-token') {
    return { uid: 'user-123', email: 'user@example.com', emailVerified: true };
  }
  throw new Error('invalid token');
};

async function startTestServer(): Promise<{ server: http.Server; port: number }> {
  const app = express();
  app.use(createAuthMiddleware(fakeVerifier));
  app.get('/whoami', (req, res) => {
    res.json({ uid: req.user?.uid, email: req.user?.email });
  });

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

async function requestWhoami(
  port: number,
  authorization?: string,
): Promise<{ statusCode: number; json: any }> {
  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/whoami',
        method: 'GET',
        headers: authorization ? { authorization } : undefined,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 0, json: data ? JSON.parse(data) : undefined });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('rejects a request with no Authorization header with 401', async () => {
  const { server, port } = await startTestServer();
  try {
    const res = await requestWhoami(port);
    assert.equal(res.statusCode, 401);
    assert.ok(res.json.error, 'a 401 should carry an error message');
  } finally {
    await closeServer(server);
  }
});

test('rejects a malformed Authorization header (not Bearer) with 401', async () => {
  const { server, port } = await startTestServer();
  try {
    const res = await requestWhoami(port, 'Basic dXNlcjpwYXNz');
    assert.equal(res.statusCode, 401);
  } finally {
    await closeServer(server);
  }
});

test('rejects a token the verifier does not accept with 401', async () => {
  const { server, port } = await startTestServer();
  try {
    const res = await requestWhoami(port, 'Bearer expired-or-forged-token');
    assert.equal(res.statusCode, 401);
  } finally {
    await closeServer(server);
  }
});

test('passes a valid Bearer token through and exposes the user on the request', async () => {
  const { server, port } = await startTestServer();
  try {
    const res = await requestWhoami(port, 'Bearer valid-token');
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.uid, 'user-123');
    assert.equal(res.json.email, 'user@example.com');
  } finally {
    await closeServer(server);
  }
});
