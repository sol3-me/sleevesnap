import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { apiFetch, setApiTokenGetter } from './apiFetch.js';

const originalFetch = globalThis.fetch;

interface CapturedRequest {
  input: RequestInfo | URL;
  headers: Record<string, string>;
}

function captureFetch(): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    captured.push({ input, headers });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return captured;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  setApiTokenGetter(async () => null);
});

test('attaches the bearer token from the token getter to the request', async () => {
  const captured = captureFetch();
  setApiTokenGetter(async () => 'fresh-id-token');

  await apiFetch('/api/collection');

  assert.equal(captured.length, 1);
  assert.equal(captured[0].headers.authorization, 'Bearer fresh-id-token');
});

test('preserves caller-provided headers alongside the token', async () => {
  const captured = captureFetch();
  setApiTokenGetter(async () => 'fresh-id-token');

  await apiFetch('/api/collection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

  assert.equal(captured[0].headers['content-type'], 'application/json');
  assert.equal(captured[0].headers.authorization, 'Bearer fresh-id-token');
});

test('sends no Authorization header when no token is available', async () => {
  const captured = captureFetch();

  await apiFetch('/api/collection');

  assert.equal(captured[0].headers.authorization, undefined);
});
