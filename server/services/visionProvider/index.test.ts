import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { identifyVinyl } from './index.js';

const originalFetch = globalThis.fetch;

// A minimal valid 1x1 JPEG, used as a realistic fixture for jimp to parse.
const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/AABEIAAQABAMBEQACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/APxfr/Kc/wC/g//Z';
const fixtureBuffer = Buffer.from(TINY_JPEG_BASE64, 'base64');

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

function geminiTextResponse(text: string): Response {
  return jsonResponse({ candidates: [{ content: { parts: [{ text }] } }] });
}

function openaiTextResponse(content: string): Response {
  return jsonResponse({ choices: [{ message: { content } }] });
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.VISION_MAX_GUESSES;
});

test('returns Gemini result when Gemini call succeeds', async () => {
  const calledUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    calledUrls.push(url);
    if (url.includes('generativelanguage.googleapis.com')) {
      return geminiTextResponse(JSON.stringify({
        isAlbumCover: true,
        guesses: [{ artist: 'Pink Floyd', title: 'The Dark Side of the Moon', confidence: 0.9 }],
      }));
    }
    throw new Error(`Unexpected fetch to ${url}`);
  }) as typeof fetch;

  const result = await identifyVinyl(fixtureBuffer);

  assert.equal(result.isAlbumCover, true);
  assert.equal(result.guesses.length, 1);
  assert.equal(result.guesses[0]?.artist, 'Pink Floyd');
  assert.equal(result.guesses[0]?.title, 'The Dark Side of the Moon');
  assert.equal(
    calledUrls.some((url) => url.includes('api.openai.com')),
    false,
  );
});

test('falls back to OpenAI when Gemini errors', async () => {
  let openaiCalled = false;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    if (url.includes('generativelanguage.googleapis.com')) {
      return jsonResponse({ error: 'boom' }, 500);
    }
    if (url.includes('api.openai.com')) {
      openaiCalled = true;
      return openaiTextResponse(JSON.stringify({
        isAlbumCover: true,
        guesses: [{ artist: 'Radiohead', title: 'OK Computer', confidence: 0.8 }],
      }));
    }
    throw new Error(`Unexpected fetch to ${url}`);
  }) as typeof fetch;

  const result = await identifyVinyl(fixtureBuffer);

  assert.equal(openaiCalled, true);
  assert.equal(result.guesses[0]?.artist, 'Radiohead');
  assert.equal(result.guesses[0]?.title, 'OK Computer');
});

test('returns an ambiguous (isAlbumCover true, no guesses) result when both providers fail', async () => {
  globalThis.fetch = (async () => jsonResponse({ error: 'boom' }, 500)) as typeof fetch;

  const result = await identifyVinyl(fixtureBuffer);

  assert.deepEqual(result, { isAlbumCover: true, guesses: [] });
});

test('logs the response status and body when a provider returns a non-2xx status', async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    if (url.includes('generativelanguage.googleapis.com')) {
      return jsonResponse({ error: { message: 'The model is overloaded. Please try again later.' } }, 503);
    }
    if (url.includes('api.openai.com')) {
      return jsonResponse({ error: { message: 'Your organization must be verified to use this model.' } }, 403);
    }
    throw new Error(`Unexpected fetch to ${url}`);
  }) as typeof fetch;

  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(' '));
  };

  try {
    await identifyVinyl(fixtureBuffer);
  } finally {
    console.warn = originalWarn;
  }

  const geminiWarning = warnings.find((line) => line.includes('Gemini call failed'));
  const openaiWarning = warnings.find((line) => line.includes('OpenAI call failed'));

  assert.ok(geminiWarning?.includes('503'), 'Gemini failure log should include the status code');
  assert.ok(geminiWarning?.includes('overloaded'), 'Gemini failure log should include the response body');
  assert.ok(openaiWarning?.includes('403'), 'OpenAI failure log should include the status code');
  assert.ok(openaiWarning?.includes('verified'), 'OpenAI failure log should include the response body');
});

test('returns an ambiguous result and makes no network calls when no API keys are configured', async () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return jsonResponse({});
  }) as typeof fetch;

  const result = await identifyVinyl(fixtureBuffer);

  assert.deepEqual(result, { isAlbumCover: true, guesses: [] });
  assert.equal(fetchCalled, false);
});

test('returns multiple guesses sorted by confidence and capped by VISION_MAX_GUESSES', async () => {
  process.env.VISION_MAX_GUESSES = '3';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    if (url.includes('generativelanguage.googleapis.com')) {
      return geminiTextResponse(JSON.stringify({
        isAlbumCover: true,
        guesses: [
          { artist: 'Queens of the Stone Age', title: 'Rated R', confidence: 1.0 },
          { artist: 'Queens of the Stone Age', title: 'Songs for the Deaf', confidence: 0.92 },
          { artist: 'Queens of the Stone Age', title: 'Lullabies to Paralyze', confidence: 0.61 },
          { artist: 'Kyuss', title: 'Welcome to Sky Valley', confidence: 0.37 },
        ],
      }));
    }
    throw new Error(`Unexpected fetch to ${url}`);
  }) as typeof fetch;

  const result = await identifyVinyl(fixtureBuffer);

  assert.equal(result.guesses.length, 3);
  assert.equal(result.guesses[0]?.title, 'Rated R');
  assert.equal(result.guesses[1]?.title, 'Songs for the Deaf');
  assert.equal(result.guesses[2]?.title, 'Lullabies to Paralyze');
  assert.ok((result.guesses[0]?.confidence ?? 0) >= (result.guesses[1]?.confidence ?? 0));
  assert.ok((result.guesses[1]?.confidence ?? 0) >= (result.guesses[2]?.confidence ?? 0));
});

// ── Non-album-cover detection ───────────────────────────────────────────────

test('reports isAlbumCover: false and no guesses when Gemini says the photo is not a record sleeve', async () => {
  let openaiCalled = false;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    if (url.includes('generativelanguage.googleapis.com')) {
      return geminiTextResponse(JSON.stringify({ isAlbumCover: false, guesses: [] }));
    }
    if (url.includes('api.openai.com')) {
      openaiCalled = true;
      return openaiTextResponse(JSON.stringify({ isAlbumCover: true, guesses: [{ artist: 'x', title: 'y', confidence: 0.5 }] }));
    }
    throw new Error(`Unexpected fetch to ${url}`);
  }) as typeof fetch;

  const result = await identifyVinyl(fixtureBuffer);

  assert.deepEqual(result, { isAlbumCover: false, guesses: [] });
  assert.equal(openaiCalled, false, 'a definitive non-album answer should not fall through to a second provider');
});

test('falls through to OpenAI when Gemini is merely uncertain (no guesses but isAlbumCover true), not just on error', async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    if (url.includes('generativelanguage.googleapis.com')) {
      return geminiTextResponse(JSON.stringify({ isAlbumCover: true, guesses: [] }));
    }
    if (url.includes('api.openai.com')) {
      return openaiTextResponse(JSON.stringify({ isAlbumCover: false, guesses: [] }));
    }
    throw new Error(`Unexpected fetch to ${url}`);
  }) as typeof fetch;

  const result = await identifyVinyl(fixtureBuffer);

  assert.deepEqual(result, { isAlbumCover: false, guesses: [] });
});

test('treats a bare guesses array (no isAlbumCover field) as an album cover, for robustness against schema drift', async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    if (url.includes('generativelanguage.googleapis.com')) {
      return geminiTextResponse(JSON.stringify([{ artist: 'Legacy', title: 'Shape', confidence: 0.7 }]));
    }
    throw new Error(`Unexpected fetch to ${url}`);
  }) as typeof fetch;

  const result = await identifyVinyl(fixtureBuffer);

  assert.equal(result.isAlbumCover, true);
  assert.equal(result.guesses[0]?.artist, 'Legacy');
});
