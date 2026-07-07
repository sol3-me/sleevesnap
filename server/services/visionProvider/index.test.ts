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

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

test('returns Gemini result when Gemini call succeeds', async () => {
  const calledUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    calledUrls.push(url);
    if (url.includes('generativelanguage.googleapis.com')) {
      return jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    artist: 'Pink Floyd',
                    title: 'The Dark Side of the Moon',
                    confidence: 0.9,
                  }),
                },
              ],
            },
          },
        ],
      });
    }
    throw new Error(`Unexpected fetch to ${url}`);
  }) as typeof fetch;

  const results = await identifyVinyl(fixtureBuffer);

  assert.equal(results.length, 1);
  assert.equal(results[0]?.artist, 'Pink Floyd');
  assert.equal(results[0]?.title, 'The Dark Side of the Moon');
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
      return jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                artist: 'Radiohead',
                title: 'OK Computer',
                confidence: 0.8,
              }),
            },
          },
        ],
      });
    }
    throw new Error(`Unexpected fetch to ${url}`);
  }) as typeof fetch;

  const results = await identifyVinyl(fixtureBuffer);

  assert.equal(openaiCalled, true);
  assert.equal(results[0]?.artist, 'Radiohead');
  assert.equal(results[0]?.title, 'OK Computer');
});

test('returns empty array when both providers fail', async () => {
  globalThis.fetch = (async () => jsonResponse({ error: 'boom' }, 500)) as typeof fetch;

  const results = await identifyVinyl(fixtureBuffer);

  assert.deepEqual(results, []);
});

test('returns empty array and makes no network calls when no API keys are configured', async () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return jsonResponse({});
  }) as typeof fetch;

  const results = await identifyVinyl(fixtureBuffer);

  assert.deepEqual(results, []);
  assert.equal(fetchCalled, false);
});
