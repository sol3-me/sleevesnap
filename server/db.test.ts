import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// db.ts reads CACHE_DB_PATH at module load time, so it must be set before
// the module is imported. Use a fresh scratch file per test run.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleevesnap-db-test-'));
process.env.CACHE_DB_PATH = path.join(scratchDir, 'cache.db');

const { initDb, incrementVisionCallCount, getVisionCallCount } = await import('./db.js');

initDb();

test('increments call_count for a new date and returns 1', () => {
  const count = incrementVisionCallCount('2026-07-08');
  assert.equal(count, 1);
});

test('increments call_count across repeated calls for the same date', () => {
  const date = '2026-07-09';
  assert.equal(incrementVisionCallCount(date), 1);
  assert.equal(incrementVisionCallCount(date), 2);
  assert.equal(incrementVisionCallCount(date), 3);
});

test('tracks separate counters for different dates independently', () => {
  assert.equal(incrementVisionCallCount('2026-01-01'), 1);
  assert.equal(incrementVisionCallCount('2026-01-02'), 1);
  assert.equal(incrementVisionCallCount('2026-01-01'), 2);
});

test('getVisionCallCount returns 0 for a date with no recorded calls', () => {
  assert.equal(getVisionCallCount('2026-03-15'), 0);
});

test('getVisionCallCount reflects prior increments without mutating the counter', () => {
  const date = '2026-04-01';
  incrementVisionCallCount(date);
  incrementVisionCallCount(date);
  incrementVisionCallCount(date);

  assert.equal(getVisionCallCount(date), 3);
  assert.equal(getVisionCallCount(date), 3, 'reading the count must not itself increment it');
});
