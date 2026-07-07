import express from 'express';
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { apiLimiter, scanLimiter } from './rateLimiters.js';

async function startTestServer(limiter: express.RequestHandler): Promise<{ server: http.Server; port: number }> {
  const app = express();
  app.get('/probe', limiter, (_req, res) => res.json({ ok: true }));

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

async function get(port: number): Promise<{ statusCode: number; json: unknown }> {
  return await new Promise((resolve, reject) => {
    http
      .get({ hostname: '127.0.0.1', port, path: '/probe' }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 0, json: data ? JSON.parse(data) : undefined });
        });
      })
      .on('error', reject);
  });
}

test('scanLimiter allows up to 30 requests per window and 429s beyond it', async () => {
  const { server, port } = await startTestServer(scanLimiter);

  try {
    const results: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await get(port);
      results.push(res.statusCode);
    }

    assert.equal(results.slice(0, 30).every((code) => code !== 429), true);
    assert.equal(results[30], 429);
  } finally {
    await closeServer(server);
  }
});

test('apiLimiter allows up to 100 requests per window and 429s beyond it', async () => {
  const { server, port } = await startTestServer(apiLimiter);

  try {
    const results: number[] = [];
    for (let i = 0; i < 101; i++) {
      const res = await get(port);
      results.push(res.statusCode);
    }

    assert.equal(results.slice(0, 100).every((code) => code !== 429), true);
    assert.equal(results[100], 429);
  } finally {
    await closeServer(server);
  }
});
