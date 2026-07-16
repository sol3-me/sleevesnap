import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWallTiles, type LandingCover } from './landingWall.js';

const PALETTE = ['#111', '#222', '#333'];

function cover(n: number): LandingCover {
  return { url: `http://covers/${n}.jpg`, artist: `Artist ${n}`, album: `Album ${n}` };
}

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
