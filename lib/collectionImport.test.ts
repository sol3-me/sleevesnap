import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCollectionImport } from './collectionImport';
import { serializeCollectionExport } from './collectionExport';
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

test('round-trips records through serializeCollectionExport -> parseCollectionImport', () => {
  const records = [makeRecord(), makeRecord({ id: 'rec-2', title: 'Geogaddi' })];
  const serialized = serializeCollectionExport(records, new Date());
  const result = parseCollectionImport(serialized);
  assert.deepEqual(result.valid, records);
  assert.deepEqual(result.errors, []);
});

test('accepts a bare array of records with no export-file wrapper', () => {
  const records = [makeRecord()];
  const result = parseCollectionImport(JSON.stringify(records));
  assert.deepEqual(result.valid, records);
  assert.deepEqual(result.errors, []);
});

test('an empty records array is valid', () => {
  const result = parseCollectionImport(JSON.stringify({ records: [] }));
  assert.deepEqual(result.valid, []);
  assert.deepEqual(result.errors, []);
});

test('rejects invalid JSON with a clear error', () => {
  const result = parseCollectionImport('{ not valid json');
  assert.deepEqual(result.valid, []);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /not valid json/i);
});

test('rejects a top-level shape that is neither an array nor a records object', () => {
  const result = parseCollectionImport(JSON.stringify({ foo: 'bar' }));
  assert.deepEqual(result.valid, []);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /records/i);
});

test('skips an entry missing a required field but keeps the rest', () => {
  const good = makeRecord();
  const missingTitle = { id: 'rec-2', artist: 'Someone', dateAdded: 1700000000000 };
  const result = parseCollectionImport(JSON.stringify({ records: [good, missingTitle] }));
  assert.deepEqual(result.valid, [good]);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /rec-2|title/i);
});

test('skips an entry with a wrong-typed dateAdded', () => {
  const good = makeRecord();
  const badDate = { id: 'rec-3', artist: 'Someone', title: 'Bad Date', dateAdded: 'not-a-number' };
  const result = parseCollectionImport(JSON.stringify({ records: [good, badDate] }));
  assert.deepEqual(result.valid, [good]);
  assert.equal(result.errors.length, 1);
});
