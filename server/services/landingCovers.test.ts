import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// db.ts reads CACHE_DB_PATH at module load time, so it must be set before
// the module (and anything that transitively imports it) is loaded.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleevesnap-landing-covers-test-'));
process.env.CACHE_DB_PATH = path.join(scratchDir, 'cache.db');

const { initDb, db } = await import('../db.js');
const { coverCacheKey, pickRandomCovers, getCachedLandingCovers, warmLandingCovers } =
  await import('./landingCovers.js');
const { LANDING_POOL } = await import('./landingPool.js');

initDb();

/** Deterministic rng so shuffle-dependent tests are reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function clearCoverCache(): void {
  db.prepare('DELETE FROM cover_cache').run();
}

function seedCover(artist: string, album: string, url: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO cover_cache (cache_key, cover_url, fetched_at) VALUES (?, ?, ?)',
  ).run(coverCacheKey(artist, album), url, Date.now());
}

test('coverCacheKey matches the covers route format: lowercased artist::album', () => {
  assert.equal(
    coverCacheKey('Pink Floyd', 'The Dark Side of the Moon'),
    'pink floyd::the dark side of the moon',
  );
});

test('pickRandomCovers returns the requested number of distinct input items', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f'];
  const picked = pickRandomCovers(items, 3, seededRandom(42));

  assert.equal(picked.length, 3);
  assert.equal(new Set(picked).size, 3);
  for (const item of picked) {
    assert.ok(items.includes(item), `picked unknown item ${item}`);
  }
});

test('pickRandomCovers returns all items when count exceeds the input size', () => {
  const items = ['a', 'b', 'c'];
  const picked = pickRandomCovers(items, 10, seededRandom(7));

  assert.deepEqual([...picked].sort(), ['a', 'b', 'c']);
});

test('pickRandomCovers does not mutate its input', () => {
  const items = ['a', 'b', 'c', 'd'];
  pickRandomCovers(items, 2, seededRandom(1));

  assert.deepEqual(items, ['a', 'b', 'c', 'd']);
});

test('pickRandomCovers is deterministic for a given rng', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];
  const first = pickRandomCovers(items, 3, seededRandom(99));
  const second = pickRandomCovers(items, 3, seededRandom(99));

  assert.deepEqual(first, second);
});

test('getCachedLandingCovers returns cached pool entries with their pool artist/album', () => {
  clearCoverCache();
  const [one, two, three] = LANDING_POOL;
  seedCover(one.artist, one.album, 'http://covers/one.jpg');
  seedCover(two.artist, two.album, 'http://covers/two.jpg');
  seedCover(three.artist, three.album, 'http://covers/three.jpg');

  const covers = getCachedLandingCovers(24, seededRandom(5));

  assert.equal(covers.length, 3);
  const byUrl = new Map(covers.map((c) => [c.url, c]));
  assert.deepEqual(byUrl.get('http://covers/one.jpg'), {
    url: 'http://covers/one.jpg',
    artist: one.artist,
    album: one.album,
  });
});

test('getCachedLandingCovers ignores cache rows that are not in the landing pool', () => {
  clearCoverCache();
  seedCover('Some Private User Search', 'Obscure Album', 'http://covers/private.jpg');

  const covers = getCachedLandingCovers(24, seededRandom(5));

  assert.deepEqual(covers, []);
});

test('getCachedLandingCovers respects count when more covers are cached', () => {
  clearCoverCache();
  for (const entry of LANDING_POOL.slice(0, 10)) {
    seedCover(entry.artist, entry.album, `http://covers/${entry.album}.jpg`);
  }

  const covers = getCachedLandingCovers(4, seededRandom(11));

  assert.equal(covers.length, 4);
});

test('warmLandingCovers fetches and caches only uncached pool entries', async () => {
  clearCoverCache();
  const pool = LANDING_POOL.slice(0, 3);
  seedCover(pool[0].artist, pool[0].album, 'http://covers/already.jpg');

  const fetched: string[] = [];
  await warmLandingCovers(
    pool,
    async (artist, album) => {
      fetched.push(`${artist}::${album}`);
      return `http://covers/${album}.jpg`;
    },
    0,
  );

  assert.deepEqual(fetched, [
    `${pool[1].artist}::${pool[1].album}`,
    `${pool[2].artist}::${pool[2].album}`,
  ]);
  const covers = getCachedLandingCovers(24, seededRandom(3));
  assert.equal(covers.length, 3);
});

test('warmLandingCovers skips null results without caching them', async () => {
  clearCoverCache();
  const pool = LANDING_POOL.slice(0, 2);

  await warmLandingCovers(pool, async () => null, 0);

  assert.deepEqual(getCachedLandingCovers(24, seededRandom(3)), []);
});

test('warmLandingCovers continues past a failing fetch', async () => {
  clearCoverCache();
  const pool = LANDING_POOL.slice(0, 3);

  await warmLandingCovers(
    pool,
    async (_artist, album) => {
      if (album === pool[0].album) throw new Error('boom');
      return `http://covers/${album}.jpg`;
    },
    0,
  );

  const covers = getCachedLandingCovers(24, seededRandom(3));
  assert.equal(covers.length, 2);
});
