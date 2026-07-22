import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCollectionExport, serializeCollectionExport } from './collectionExport';
import { VinylRecord } from '../types';

function makeRecord(overrides: Partial<VinylRecord> = {}): VinylRecord {
  return {
    id: 'rec-1',
    artist: 'Boards of Canada',
    title: 'Music Has the Right to Children',
    dateAdded: 1700000000000,
    ...overrides,
  };
}

test('buildCollectionExport stamps schemaVersion, app, and exportedAt', () => {
  const now = new Date('2026-07-22T12:00:00.000Z');
  const result = buildCollectionExport([], now);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.app, 'sleevesnap');
  assert.equal(result.exportedAt, '2026-07-22T12:00:00.000Z');
});

test('buildCollectionExport passes records through unchanged', () => {
  const records = [makeRecord(), makeRecord({ id: 'rec-2', title: 'Geogaddi' })];
  const result = buildCollectionExport(records, new Date());
  assert.deepEqual(result.records, records);
});

test('buildCollectionExport handles an empty collection', () => {
  const result = buildCollectionExport([], new Date());
  assert.deepEqual(result.records, []);
});

test('serializeCollectionExport round-trips through JSON.parse', () => {
  const records = [makeRecord()];
  const now = new Date('2026-07-22T12:00:00.000Z');
  const serialized = serializeCollectionExport(records, now);
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.app, 'sleevesnap');
  assert.equal(parsed.exportedAt, '2026-07-22T12:00:00.000Z');
  assert.deepEqual(parsed.records, records);
});
