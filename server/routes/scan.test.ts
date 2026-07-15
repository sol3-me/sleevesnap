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

/** One release-group search result plus the enrichment fetches searchGroups makes for it. */
function releaseGroupSearchMocks(url: string, groupId: string, title: string, artist: string): Response | undefined {
  const normalized = url.toLowerCase();
  if (normalized.includes('/ws/2/release-group?')) {
    return jsonResponse({
      count: 1,
      'release-groups': [
        {
          id: groupId,
          title,
          'first-release-date': '2000-06-06',
          'primary-type': 'Album',
          'artist-credit': [{ artist: { name: artist } }],
        },
      ],
    });
  }
  if (normalized.includes('/ws/2/release?') && normalized.includes('rgid')) {
    return jsonResponse({
      releases: [
        {
          id: `${groupId}-release-1`,
          title,
          date: '2000-06-06',
          media: [{ format: '12" Vinyl' }],
          'artist-credit': [{ artist: { name: artist } }],
        },
      ],
    });
  }
  if (normalized.includes(`/ws/2/release-group/${groupId}`)) {
    return jsonResponse({ relations: [] });
  }
  return undefined;
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
    const mbResponse = releaseGroupSearchMocks(url, 'group-1', 'Rated R', 'Queens of the Stone Age');
    if (mbResponse) return mbResponse;
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
    assert.equal(Array.isArray(res.json.vision?.guesses), true);
    const guess = res.json.vision?.guesses[0];
    assert.equal(guess?.title, 'Rated R');
    assert.equal(guess?.validated, true, 'a guess that MusicBrainz finds a release group for must be marked validated');
    assert.equal(Array.isArray(guess?.matchedGroups), true);
    assert.equal(guess?.matchedGroups[0]?.releaseGroupId, 'group-1');
    assert.equal(guess?.matchedGroups[0]?.title, 'Rated R');
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
    assert.equal(res.json.vision?.guesses?.length > 0, true);
    assert.equal(res.json.vision?.guesses[0]?.validated, true);
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

function threeGuessVisionResponse(): Response {
  return jsonResponse({
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify([
                { artist: 'Queens of the Stone Age', title: 'Rated R', confidence: 1.0 },
                { artist: 'Queens of the Stone Age', title: 'Songs for the Deaf', confidence: 0.92 },
                { artist: 'Queens of the Stone Age', title: 'Lullabies to Paralyze', confidence: 0.6 },
              ]),
            },
          ],
        },
      },
    ],
  });
}

test('POST /api/scan validates each guess with a structured release-group search and flags them individually', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    const normalizedUrl = url.toLowerCase();
    if (url.includes('generativelanguage.googleapis.com')) {
      return threeGuessVisionResponse();
    }

    // Structured group search: only "Songs for the Deaf" finds anything.
    if (normalizedUrl.includes('/ws/2/release-group?')) {
      // The query must be the structured (indexed) form, with the artist and
      // title as separate fielded clauses — not a flat combined string.
      assert.equal(normalizedUrl.includes('artist'), true, 'validation query must contain a fielded artist clause');
      assert.equal(normalizedUrl.includes('releasegroup'), true, 'validation query must contain a fielded title clause');
      if (normalizedUrl.includes('songs') && normalizedUrl.includes('deaf')) {
        return jsonResponse({
          count: 1,
          'release-groups': [
            {
              id: 'group-sftd',
              title: 'Songs for the Deaf',
              'first-release-date': '2002-08-27',
              'primary-type': 'Album',
              'artist-credit': [{ artist: { name: 'Queens of the Stone Age' } }],
            },
          ],
        });
      }
      return jsonResponse({ count: 0, 'release-groups': [] });
    }
    const enrichment = releaseGroupSearchMocks(url, 'group-sftd', 'Songs for the Deaf', 'Queens of the Stone Age');
    if (enrichment) return enrichment;

    throw new Error(`Unexpected fetch to ${url}`);
  }) as typeof fetch;

  const { server, port } = await startTestServer();
  try {
    const res = await postScan(port, TINY_JPEG_BASE64);

    assert.equal(res.statusCode, 200);
    assert.equal(res.json.matched, false);
    assert.equal(Array.isArray(res.json.vision?.guesses), true);
    assert.equal(res.json.vision?.guesses.length, 3);

    const [ratedR, sftd, lullabies] = res.json.vision.guesses;
    assert.equal(ratedR.title, 'Rated R');
    assert.equal(ratedR.validated, false, 'a guess MusicBrainz has no release group for must not be validated');
    assert.deepEqual(ratedR.matchedGroups, []);

    assert.equal(sftd.title, 'Songs for the Deaf');
    assert.equal(sftd.validated, true);
    assert.equal(sftd.matchedGroups[0]?.releaseGroupId, 'group-sftd');
    assert.equal(sftd.matchedGroups[0]?.availableFormats?.includes('12" Vinyl'), true);

    assert.equal(lullabies.title, 'Lullabies to Paralyze');
    assert.equal(lullabies.validated, false);
  } finally {
    await closeServer(server);
  }
});

test('POST /api/scan degrades a guess to unvalidated when its validation search fails, without failing the scan', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    const normalizedUrl = url.toLowerCase();
    if (url.includes('generativelanguage.googleapis.com')) {
      return threeGuessVisionResponse();
    }

    if (normalizedUrl.includes('/ws/2/release-group?')) {
      // "Rated R" validation blows up server-side; the others behave.
      if (normalizedUrl.includes('rated')) {
        return jsonResponse({ error: 'boom' }, 500);
      }
      if (normalizedUrl.includes('songs') && normalizedUrl.includes('deaf')) {
        return jsonResponse({
          count: 1,
          'release-groups': [
            {
              id: 'group-sftd',
              title: 'Songs for the Deaf',
              'first-release-date': '2002-08-27',
              'primary-type': 'Album',
              'artist-credit': [{ artist: { name: 'Queens of the Stone Age' } }],
            },
          ],
        });
      }
      return jsonResponse({ count: 0, 'release-groups': [] });
    }
    const enrichment = releaseGroupSearchMocks(url, 'group-sftd', 'Songs for the Deaf', 'Queens of the Stone Age');
    if (enrichment) return enrichment;

    throw new Error(`Unexpected fetch to ${url}`);
  }) as typeof fetch;

  const { server, port } = await startTestServer();
  try {
    const res = await postScan(port, TINY_JPEG_BASE64);

    assert.equal(res.statusCode, 200);
    assert.equal(res.json.matched, false);
    assert.equal(res.json.vision?.guesses.length, 3);
    assert.equal(res.json.vision?.guesses[0]?.validated, false);
    assert.equal(res.json.vision?.guesses[1]?.validated, true);
  } finally {
    await closeServer(server);
  }
});
