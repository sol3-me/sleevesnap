import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// db.ts reads CACHE_DB_PATH at module load time, so it must be set before
// the module is imported. Use a fresh scratch file per test run.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleevesnap-db-test-'));
process.env.CACHE_DB_PATH = path.join(scratchDir, 'cache.db');

const { initDb, incrementUserVisionCallCount, getUserVisionCallCount } = await import('./db.js');

initDb();

test('increments call_count for a new user/date pair and returns 1', () => {
  const count = incrementUserVisionCallCount('2026-07-08', 'user-a');
  assert.equal(count, 1);
});

test('increments call_count across repeated calls for the same user/date', () => {
  const date = '2026-07-09';
  assert.equal(incrementUserVisionCallCount(date, 'user-a'), 1);
  assert.equal(incrementUserVisionCallCount(date, 'user-a'), 2);
  assert.equal(incrementUserVisionCallCount(date, 'user-a'), 3);
});

test('tracks separate counters for different dates independently', () => {
  assert.equal(incrementUserVisionCallCount('2026-01-01', 'user-a'), 1);
  assert.equal(incrementUserVisionCallCount('2026-01-02', 'user-a'), 1);
  assert.equal(incrementUserVisionCallCount('2026-01-01', 'user-a'), 2);
});

test('tracks separate counters for different users on the same date', () => {
  const date = '2026-02-01';
  assert.equal(incrementUserVisionCallCount(date, 'user-a'), 1);
  assert.equal(incrementUserVisionCallCount(date, 'user-b'), 1, "user-b's count must not inherit user-a's usage");
  assert.equal(incrementUserVisionCallCount(date, 'user-a'), 2);
});

test('getUserVisionCallCount returns 0 for a user/date with no recorded calls', () => {
  assert.equal(getUserVisionCallCount('2026-03-15', 'user-a'), 0);
});

test('getUserVisionCallCount reflects prior increments without mutating the counter', () => {
  const date = '2026-04-01';
  incrementUserVisionCallCount(date, 'user-a');
  incrementUserVisionCallCount(date, 'user-a');
  incrementUserVisionCallCount(date, 'user-a');

  assert.equal(getUserVisionCallCount(date, 'user-a'), 3);
  assert.equal(getUserVisionCallCount(date, 'user-a'), 3, 'reading the count must not itself increment it');
});

test('getUserVisionCallCount does not mix counts between users', () => {
  const date = '2026-05-01';
  incrementUserVisionCallCount(date, 'user-a');
  incrementUserVisionCallCount(date, 'user-a');
  incrementUserVisionCallCount(date, 'user-b');

  assert.equal(getUserVisionCallCount(date, 'user-a'), 2);
  assert.equal(getUserVisionCallCount(date, 'user-b'), 1);
});
