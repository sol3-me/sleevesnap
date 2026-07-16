import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildWallTiles,
  pickWallCovers,
  wallTileCountFor,
  type LandingCover,
} from './landingWall.js';

const PALETTE = ['#111', '#222', '#333'];

function cover(n: number): LandingCover {
  return { url: `http://covers/${n}.jpg`, artist: `Artist ${n}`, album: `Album ${n}` };
}

/** Deterministic rng so selection tests are reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

test('wallTileCountFor gives mobile fewer tiles than desktop', () => {
  assert.equal(wallTileCountFor(375), 20);
  assert.equal(wallTileCountFor(639), 20);
  assert.equal(wallTileCountFor(640), 30);
  assert.equal(wallTileCountFor(1023), 30);
  assert.equal(wallTileCountFor(1024), 40);
  assert.equal(wallTileCountFor(1920), 40);
});

test('pickWallCovers returns the requested number of covers with no duplicates', () => {
  const pool = Array.from({ length: 50 }, (_, n) => cover(n));
  const picked = pickWallCovers(pool, 20, seededRandom(42));

  assert.equal(picked.length, 20);
  assert.equal(new Set(picked.map((c) => c.url)).size, 20);
  for (const c of picked) {
    assert.ok(pool.includes(c), `picked unknown cover ${c.url}`);
  }
});

test('pickWallCovers returns the whole pool when count exceeds it', () => {
  const pool = [cover(1), cover(2), cover(3)];
  const picked = pickWallCovers(pool, 40, seededRandom(7));

  assert.equal(picked.length, 3);
  assert.equal(new Set(picked.map((c) => c.url)).size, 3);
});

test('pickWallCovers is deterministic for a given rng and does not mutate input', () => {
  const pool = Array.from({ length: 10 }, (_, n) => cover(n));
  const snapshot = [...pool];
  const first = pickWallCovers(pool, 4, seededRandom(99));
  const second = pickWallCovers(pool, 4, seededRandom(99));

  assert.deepEqual(first, second);
  assert.deepEqual(pool, snapshot);
});

test('pickWallCovers with an empty pool returns an empty selection', () => {
  assert.deepEqual(pickWallCovers([], 20, seededRandom(1)), []);
});

test('buildWallTiles always returns exactly `total` tiles', () => {
  const tiles = buildWallTiles([cover(1), cover(2)], 9, PALETTE);
  assert.equal(tiles.length, 9);
});

test('buildWallTiles puts covers first, preserving their order', () => {
  const covers = [cover(1), cover(2), cover(3)];
  const tiles = buildWallTiles(covers, 6, PALETTE);

  assert.deepEqual(tiles.slice(0, 3), [
    { kind: 'cover', url: 'http://covers/1.jpg', artist: 'Artist 1', album: 'Album 1' },
    { kind: 'cover', url: 'http://covers/2.jpg', artist: 'Artist 2', album: 'Album 2' },
    { kind: 'cover', url: 'http://covers/3.jpg', artist: 'Artist 3', album: 'Album 3' },
  ]);
});

test('buildWallTiles fills the remainder with placeholders cycling the palette', () => {
  const tiles = buildWallTiles([cover(1)], 8, PALETTE);
  const placeholders = tiles.slice(1);

  assert.deepEqual(placeholders, [
    { kind: 'placeholder', color: '#111' },
    { kind: 'placeholder', color: '#222' },
    { kind: 'placeholder', color: '#333' },
    { kind: 'placeholder', color: '#111' },
    { kind: 'placeholder', color: '#222' },
    { kind: 'placeholder', color: '#333' },
    { kind: 'placeholder', color: '#111' },
  ]);
});

test('buildWallTiles truncates covers when there are more than total', () => {
  const covers = [cover(1), cover(2), cover(3), cover(4)];
  const tiles = buildWallTiles(covers, 2, PALETTE);

  assert.equal(tiles.length, 2);
  assert.deepEqual(
    tiles.map((t) => t.kind),
    ['cover', 'cover'],
  );
});

test('buildWallTiles with no covers is all placeholders', () => {
  const tiles = buildWallTiles([], 4, PALETTE);

  assert.deepEqual(
    tiles.map((t) => t.kind),
    ['placeholder', 'placeholder', 'placeholder', 'placeholder'],
  );
});
