import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { searchArtistEntities, searchLabelEntities, searchVinylReleaseGroups } from './vinylService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const originalFetch = globalThis.fetch;

// Real responses from sleevesnap's own /api/search/groups endpoint, captured
// live for a bug report: typing "songs for the de" found nothing, and
// re-typing that exact fragment later kept finding nothing even after
// longer variants ("songs for the dea", "songs for the deaf") proved
// results existed. Root cause: the client cached the empty result for 6
// hours, so retrying the identical (still legitimately empty) fragment
// never gave the API another chance.
function loadFixture(name: string) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf-8'));
}

const emptyResult = loadFixture('discover-groups-songs-for-the-de.json'); // genuinely 0 matches
const threeResults = loadFixture('discover-groups-songs-for-the-dea.json'); // 3 matches
const oneResult = loadFixture('discover-groups-songs-for-the-deaf.json'); // 1 match

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('does not cache an empty result — an identical repeated query still hits the API', async () => {
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    return jsonResponse(emptyResult);
  }) as typeof fetch;

  const first = await searchVinylReleaseGroups('songs for the de', 1, 5);
  const second = await searchVinylReleaseGroups('songs for the de', 1, 5);

  assert.equal(first.groups.length, 0);
  assert.equal(second.groups.length, 0);
  assert.equal(fetchCalls, 2, 'an empty result must never be served from cache');
});

test('caches a non-empty result — an identical repeated query is served from cache', async () => {
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    return jsonResponse(oneResult);
  }) as typeof fetch;

  const first = await searchVinylReleaseGroups('songs for the deaf', 1, 5);
  const second = await searchVinylReleaseGroups('songs for the deaf', 1, 5);

  assert.equal(first.groups.length, 1);
  assert.deepEqual(second, first);
  assert.equal(fetchCalls, 1, 'a confirmed non-empty result should be served from cache on an identical repeat');
});

test('reproduces the real bug scenario: shorter fragment stays empty, longer fragment finds results, and neither leaks into the other', async () => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { query?: string };
    if (body.query === 'songs for the de') return jsonResponse(emptyResult);
    if (body.query === 'songs for the dea') return jsonResponse(threeResults);
    if (body.query === 'songs for the deaf') return jsonResponse(oneResult);
    throw new Error(`Unexpected query in test: ${body.query}`);
  }) as typeof fetch;

  const shortFragment = await searchVinylReleaseGroups('songs for the de', 1, 5);
  const longerFragment = await searchVinylReleaseGroups('songs for the dea', 1, 5);
  const fullTitle = await searchVinylReleaseGroups('songs for the deaf', 1, 5);

  assert.equal(shortFragment.groups.length, 0);
  assert.equal(longerFragment.groups.length, 3);
  assert.equal(fullTitle.groups.length, 1);
  assert.ok(
    longerFragment.groups.some((g) => g.title === 'Songs for the Deaf'),
    'the 3-result fragment should include the real album',
  );

  // Re-typing the exact empty fragment again must still ask the API, not
  // reuse whatever the longer/adjacent queries returned.
  const shortFragmentAgain = await searchVinylReleaseGroups('songs for the de', 1, 5);
  assert.equal(shortFragmentAgain.groups.length, 0);
});

test('throws on a failed request instead of returning a fake empty page', async () => {
  globalThis.fetch = (async () => jsonResponse({ error: 'boom' }, 502)) as typeof fetch;

  await assert.rejects(() => searchVinylReleaseGroups('anything', 1, 5));
});

test('forwards indexed intent payload to /api/search/groups for field-specific search mode', async () => {
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return jsonResponse(oneResult);
  }) as typeof fetch;

  await searchVinylReleaseGroups({
    mode: 'indexed',
    intent: {
      artist: 'Kings of Leon',
    },
    page: 1,
    pageSize: 5,
  });

  assert.ok(capturedBody);
  assert.equal(capturedBody.mode, 'indexed');
  assert.deepEqual(capturedBody.intent, { artist: 'Kings of Leon' });
  assert.equal(capturedBody.page, 1);
  assert.equal(capturedBody.pageSize, 5);
});

test('uses different cache keys for different indexed intent shapes', async () => {
  const requestedBodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input, init) => {
    requestedBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return jsonResponse(oneResult);
  }) as typeof fetch;

  await searchVinylReleaseGroups({
    mode: 'indexed',
    intent: { title: 'Only by the Night Cache Test' },
    page: 1,
    pageSize: 5,
  });

  await searchVinylReleaseGroups({
    mode: 'indexed',
    intent: { artist: 'Kings of Leon Cache Test' },
    page: 1,
    pageSize: 5,
  });

  assert.equal(requestedBodies.length, 2);
  assert.deepEqual(requestedBodies[0]?.intent, { title: 'Only by the Night Cache Test' });
  assert.deepEqual(requestedBodies[1]?.intent, { artist: 'Kings of Leon Cache Test' });
});

test('forwards artist entity lookup payload to /api/search/artists', async () => {
  let capturedUrl = '';
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (input, init) => {
    capturedUrl = typeof input === 'string' ? input : input.toString();
    capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return jsonResponse({
      query: 'queen',
      page: 1,
      pageSize: 10,
      total: 1,
      hasMore: false,
      entities: [{ id: 'artist-1', name: 'Queen' }],
    });
  }) as typeof fetch;

  const res = await searchArtistEntities({ query: 'queen' });

  assert.equal(capturedUrl, '/api/search/artists');
  assert.deepEqual(capturedBody, { query: 'queen', page: 1, pageSize: 10 });
  assert.equal(res.entities.length, 1);
  assert.equal(res.entities[0]?.name, 'Queen');
});

test('uses distinct caches for artist and label entity lookups', async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);
    return jsonResponse({
      query: 'emi',
      page: 1,
      pageSize: 10,
      total: 1,
      hasMore: false,
      entities: [{ id: 'entity-1', name: 'EMI' }],
    });
  }) as typeof fetch;

  await searchArtistEntities({ query: 'emi', page: 1, pageSize: 10 });
  await searchArtistEntities({ query: 'emi', page: 1, pageSize: 10 });
  await searchLabelEntities({ query: 'emi', page: 1, pageSize: 10 });
  await searchLabelEntities({ query: 'emi', page: 1, pageSize: 10 });

  assert.deepEqual(calls, ['/api/search/artists', '/api/search/labels']);
});

test('uses different cache keys for indexed artistId selections', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return jsonResponse(oneResult);
  }) as typeof fetch;

  await searchVinylReleaseGroups({
    mode: 'indexed',
    intent: { artistId: 'artist-mbid-1', artist: 'Queen' },
    page: 1,
    pageSize: 10,
  });

  await searchVinylReleaseGroups({
    mode: 'indexed',
    intent: { artistId: 'artist-mbid-2', artist: 'Queen' },
    page: 1,
    pageSize: 10,
  });

  assert.equal(calls, 2);
});

test('uses different cache keys for indexed primary-type include and exclude filters', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return jsonResponse(oneResult);
  }) as typeof fetch;

  await searchVinylReleaseGroups({
    mode: 'indexed',
    intent: {
      artistId: 'artist-mbid-1',
      primaryTypes: ['album'],
    },
    page: 1,
    pageSize: 10,
  });

  await searchVinylReleaseGroups({
    mode: 'indexed',
    intent: {
      artistId: 'artist-mbid-1',
      excludePrimaryTypes: ['album', 'single', 'ep'],
    },
    page: 1,
    pageSize: 10,
  });

  assert.equal(calls, 2);
});
