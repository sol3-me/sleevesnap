import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

// db.ts reads CACHE_DB_PATH at module load time, so it must be set before
// the module (and anything that transitively imports it) is loaded.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleevesnap-legacy-claim-test-'));
process.env.CACHE_DB_PATH = path.join(scratchDir, 'cache.db');

const { initDb, db } = await import('./db.js');
const { claimLegacyRows } = await import('./legacyClaim.js');

initDb();

function insertLegacyCollectionRow(id: string, userId: string | null = null): void {
  db.prepare(
    'INSERT INTO collection (id, artist, title, date_added, user_id) VALUES (?, ?, ?, ?, ?)',
  ).run(id, 'Legacy Artist', `Legacy Album ${id}`, Date.now(), userId);
}

function insertLegacyScanHistoryRow(id: string, userId: string | null = null): void {
  db.prepare(
    "INSERT INTO scan_history (id, created_at, searches, user_id) VALUES (?, ?, '[]', ?)",
  ).run(id, Date.now(), userId);
}

function collectionOwner(id: string): string | null {
  const row = db.prepare('SELECT user_id FROM collection WHERE id = ?').get(id) as
    | { user_id: string | null }
    | undefined;
  return row?.user_id ?? null;
}

function scanHistoryOwner(id: string): string | null {
  const row = db.prepare('SELECT user_id FROM scan_history WHERE id = ?').get(id) as
    | { user_id: string | null }
    | undefined;
  return row?.user_id ?? null;
}

afterEach(() => {
  delete process.env.LEGACY_CLAIM_EMAIL;
  db.exec('DELETE FROM collection');
  db.exec('DELETE FROM scan_history');
});

test('a verified sign-in matching LEGACY_CLAIM_EMAIL adopts all unowned rows', () => {
  process.env.LEGACY_CLAIM_EMAIL = 'owner@example.com';
  insertLegacyCollectionRow('legacy-record');
  insertLegacyScanHistoryRow('legacy-scan');

  claimLegacyRows({ uid: 'owner-uid', email: 'owner@example.com', emailVerified: true });

  assert.equal(collectionOwner('legacy-record'), 'owner-uid');
  assert.equal(scanHistoryOwner('legacy-scan'), 'owner-uid');
});

test('the email match is case-insensitive', () => {
  process.env.LEGACY_CLAIM_EMAIL = 'Owner@Example.com';
  insertLegacyCollectionRow('legacy-record');

  claimLegacyRows({ uid: 'owner-uid', email: 'owner@EXAMPLE.com', emailVerified: true });

  assert.equal(collectionOwner('legacy-record'), 'owner-uid');
});

test('a different email never claims the legacy rows', () => {
  process.env.LEGACY_CLAIM_EMAIL = 'owner@example.com';
  insertLegacyCollectionRow('legacy-record');

  claimLegacyRows({ uid: 'stranger-uid', email: 'stranger@example.com', emailVerified: true });

  assert.equal(collectionOwner('legacy-record'), null, 'rows must stay unowned for a non-matching email');
});

test('an unverified email never claims, even when it matches', () => {
  process.env.LEGACY_CLAIM_EMAIL = 'owner@example.com';
  insertLegacyCollectionRow('legacy-record');

  // Anyone can create an email/password account claiming an address they
  // don't control — only a verified email may adopt the legacy data.
  claimLegacyRows({ uid: 'impostor-uid', email: 'owner@example.com', emailVerified: false });

  assert.equal(collectionOwner('legacy-record'), null);
});

test('no LEGACY_CLAIM_EMAIL configured means nothing is ever claimed', () => {
  insertLegacyCollectionRow('legacy-record');

  claimLegacyRows({ uid: 'owner-uid', email: 'owner@example.com', emailVerified: true });

  assert.equal(collectionOwner('legacy-record'), null);
});

test("claiming never touches rows already owned by another user", () => {
  process.env.LEGACY_CLAIM_EMAIL = 'owner@example.com';
  insertLegacyCollectionRow('legacy-record');
  insertLegacyCollectionRow('someone-elses-record', 'other-uid');
  insertLegacyScanHistoryRow('someone-elses-scan', 'other-uid');

  claimLegacyRows({ uid: 'owner-uid', email: 'owner@example.com', emailVerified: true });

  assert.equal(collectionOwner('legacy-record'), 'owner-uid');
  assert.equal(collectionOwner('someone-elses-record'), 'other-uid');
  assert.equal(scanHistoryOwner('someone-elses-scan'), 'other-uid');
});
