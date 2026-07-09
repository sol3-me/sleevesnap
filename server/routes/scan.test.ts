import express from 'express';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

// db.ts reads CACHE_DB_PATH at module load time, so it must be set before
// the module (and anything that transitively imports it) is loaded.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleevesnap-scan-test-'));
process.env.CACHE_DB_PATH = path.join(scratchDir, 'cache.db');

const { initDb, db } = await import('../db.js');
const { computeHash } = await import('../imageHash.js');
const { scanRouter } = await import('./scan.js');

initDb();

const originalFetch = globalThis.fetch;

// A minimal valid 1x1 JPEG.
const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/AABEIAAQABAMBEQACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/APxfr/Kc/wC/g//Z';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function successfulVisionMock(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    if (url.includes('generativelanguage.googleapis.com')) {
      return jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    artist: 'Queens of the Stone Age',
                    title: 'Rated R',
                    confidence: 0.9,
                  }),
                },
              ],
            },
          },
        ],
      });
    }
    if (url.includes('musicbrainz.org')) {
      return jsonResponse({
        releases: [
          {
            id: 'release-1',
            title: 'Rated R',
            date: '2000-06-06',
            media: [{ format: '12" Vinyl' }],
            'artist-credit': [{ artist: { name: 'Queens of the Stone Age' } }],
            'release-group': { id: 'group-1', title: 'Rated R', 'primary-type': 'Album' },
          },
        ],
      });
    }
    throw new Error(`Unexpected fetch to ${url}`);
  }) as typeof fetch;
}

async function startTestServer(): Promise<{ server: http.Server; port: number }> {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/api/scan', scanRouter);

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

async function postScan(
  port: number,
  base64Image: string,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; json: any }> {
  return await new Promise((resolve, reject) => {
    const payload = JSON.stringify({ base64Image });
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/scan',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...headers,
        },
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
    req.write(payload);
    req.end();
  });
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.VISION_DAILY_LIMIT;
  delete process.env.VISION_ADMIN_KEY;
  db.exec('DELETE FROM collection');
  db.exec('DELETE FROM vision_call_tracker');
});

test('POST /api/scan falls through to vision suggestions when no pHash match exists', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  globalThis.fetch = successfulVisionMock();

  const { server, port } = await startTestServer();
  try {
    const res = await postScan(port, TINY_JPEG_BASE64);

    assert.equal(res.statusCode, 200);
    assert.equal(res.json.matched, false);
    assert.equal(Array.isArray(res.json.suggestions), true);
    assert.equal(res.json.suggestions.length > 0, true);
    assert.equal(res.json.suggestions[0].artist, 'Queens of the Stone Age');
    assert.equal(Array.isArray(res.json.vision?.guesses), true);
    assert.equal(res.json.vision?.guesses[0]?.title, 'Rated R');
    assert.equal(res.json.vision?.suggestedQuery, 'Queens of the Stone Age Rated R');
  } finally {
    await closeServer(server);
  }
});

test('POST /api/scan omits suggestions when the vision call fails', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  globalThis.fetch = (async () => jsonResponse({ error: 'boom' }, 500)) as typeof fetch;

  const { server, port } = await startTestServer();
  try {
    const res = await postScan(port, TINY_JPEG_BASE64);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json, { matched: false });
  } finally {
    await closeServer(server);
  }
});

test('POST /api/scan skips the vision call when the daily cap is already exceeded', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.VISION_DAILY_LIMIT = '2';
  db.prepare(
    'INSERT INTO vision_call_tracker (date, call_count) VALUES (?, ?)',
  ).run(todayKey(), 2);

  let visionCalled = false;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    if (url.includes('generativelanguage.googleapis.com') || url.includes('api.openai.com')) {
      visionCalled = true;
    }
    return jsonResponse({ error: 'should not be called' }, 500);
  }) as typeof fetch;

  const { server, port } = await startTestServer();
  try {
    const res = await postScan(port, TINY_JPEG_BASE64);

    assert.deepEqual(res.json, { matched: false });
    assert.equal(visionCalled, false);
  } finally {
    await closeServer(server);
  }
});

test('POST /api/scan bypasses the daily cap when X-Vision-Admin-Key matches VISION_ADMIN_KEY', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.VISION_DAILY_LIMIT = '2';
  process.env.VISION_ADMIN_KEY = 'test-secret';
  db.prepare(
    'INSERT INTO vision_call_tracker (date, call_count) VALUES (?, ?)',
  ).run(todayKey(), 2);
  globalThis.fetch = successfulVisionMock();

  const { server, port } = await startTestServer();
  try {
    const res = await postScan(port, TINY_JPEG_BASE64, { 'X-Vision-Admin-Key': 'test-secret' });

    assert.equal(res.json.matched, false);
    assert.equal(res.json.suggestions?.length > 0, true);
    assert.equal(res.json.vision?.guesses?.length > 0, true);
  } finally {
    await closeServer(server);
  }
});

test('POST /api/scan still enforces the cap when X-Vision-Admin-Key does not match', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.VISION_DAILY_LIMIT = '2';
  process.env.VISION_ADMIN_KEY = 'test-secret';
  db.prepare(
    'INSERT INTO vision_call_tracker (date, call_count) VALUES (?, ?)',
  ).run(todayKey(), 2);

  let visionCalled = false;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    if (url.includes('generativelanguage.googleapis.com') || url.includes('api.openai.com')) {
      visionCalled = true;
    }
    return jsonResponse({ error: 'should not be called' }, 500);
  }) as typeof fetch;

  const { server, port } = await startTestServer();
  try {
    const res = await postScan(port, TINY_JPEG_BASE64, { 'X-Vision-Admin-Key': 'wrong-value' });

    assert.deepEqual(res.json, { matched: false });
    assert.equal(visionCalled, false);
  } finally {
    await closeServer(server);
  }
});

test('POST /api/scan returns the local match immediately without calling vision', async () => {
  const fixtureBuffer = Buffer.from(TINY_JPEG_BASE64, 'base64');
  const hash = await computeHash(fixtureBuffer);
  db.prepare(
    `INSERT INTO collection (id, artist, title, date_added, phash) VALUES (?, ?, ?, ?, ?)`,
  ).run('existing-1', 'Existing Artist', 'Existing Album', Date.now(), hash);

  process.env.GEMINI_API_KEY = 'test-key';
  let visionCalled = false;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    if (url.includes('generativelanguage.googleapis.com') || url.includes('api.openai.com')) {
      visionCalled = true;
    }
    return jsonResponse({ error: 'should not be called' }, 500);
  }) as typeof fetch;

  const { server, port } = await startTestServer();
  try {
    const res = await postScan(port, TINY_JPEG_BASE64);

    assert.equal(res.json.matched, true);
    assert.equal(res.json.record.artist, 'Existing Artist');
    assert.equal(visionCalled, false);
  } finally {
    await closeServer(server);
  }
});
