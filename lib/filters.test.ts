import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bucketForFormat,
  formatBucketsForGroup,
  groupReleasesByFormatBucket,
  loadStoredFilterState,
  sortBucketsWithPriority,
  sortFormatBuckets,
  sortTypeBuckets,
  typeBucketForGroup,
} from './filters.js';
import { SearchResultGroup } from '../types.js';

function makeGroup(overrides: Partial<SearchResultGroup> = {}): SearchResultGroup {
  return {
    releaseGroupId: 'group-1',
    title: 'Test Album',
    artist: 'Test Artist',
    releaseGroupUrl: 'https://musicbrainz.org/release-group/group-1',
    availableFormats: [],
    totalReleases: 1,
    ...overrides,
  };
}

test('bucketForFormat merges vinyl/LP variants into "Vinyl" and CD variants into "CD"', () => {
  assert.equal(bucketForFormat('12" Vinyl'), 'Vinyl');
  assert.equal(bucketForFormat('LP'), 'Vinyl');
  assert.equal(bucketForFormat('CD-R'), 'CD');
});

// The \bcd\b pattern requires a word boundary immediately before "cd", so a
// format like "2xCD" (no boundary between "x" and "C") does NOT merge into
// the "CD" bucket — it's treated as its own distinct format. Documenting
// this as current behavior rather than "fixing" it, since MusicBrainz rarely
// uses this exact shorthand and changing the regex is outside this task's
// scope (a pure extraction, not a behavior change).
test('bucketForFormat does not merge "2xCD" into "CD" (no word boundary before the C)', () => {
  assert.equal(bucketForFormat('2xCD'), '2xCD');
});

test('bucketForFormat leaves unrecognised formats untouched', () => {
  assert.equal(bucketForFormat('Digital Media'), 'Digital Media');
  assert.equal(bucketForFormat('Cassette'), 'Cassette');
});

test('formatBucketsForGroup dedupes formats that merge into the same bucket', () => {
  const group = makeGroup({ availableFormats: ['12" Vinyl', 'LP', 'CD-R', 'Digital Media'] });
  assert.deepEqual(formatBucketsForGroup(group), ['Vinyl', 'CD', 'Digital Media']);
});

test('typeBucketForGroup passes MusicBrainz primaryType through directly', () => {
  assert.equal(typeBucketForGroup(makeGroup({ primaryType: 'Single' })), 'Single');
});

test('typeBucketForGroup defaults to "Unknown" when primaryType is absent', () => {
  assert.equal(typeBucketForGroup(makeGroup()), 'Unknown');
});

test('sortBucketsWithPriority orders priority items first, then alphabetical, then Unknown last', () => {
  const buckets = ['Unknown', 'Cassette', 'CD', 'Vinyl', 'Digital Media'];
  assert.deepEqual(
    sortBucketsWithPriority(buckets, ['Vinyl', 'CD']),
    ['Vinyl', 'CD', 'Cassette', 'Digital Media', 'Unknown'],
  );
});

test('sortBucketsWithPriority handles a priority bucket that is absent from the input', () => {
  assert.deepEqual(sortBucketsWithPriority(['CD', 'Cassette'], ['Vinyl', 'CD']), ['CD', 'Cassette']);
});

test('sortFormatBuckets prioritises Vinyl and CD over other formats', () => {
  assert.deepEqual(sortFormatBuckets(['Digital Media', 'CD', 'Vinyl']), ['Vinyl', 'CD', 'Digital Media']);
});

test('sortTypeBuckets prioritises Album, Single, EP over other types', () => {
  assert.deepEqual(sortTypeBuckets(['Broadcast', 'EP', 'Single', 'Album']), ['Album', 'Single', 'EP', 'Broadcast']);
});

test('groupReleasesByFormatBucket groups by bucket while preserving each release\'s exact original format string', () => {
  const releases = [
    { id: '1', format: '12" Vinyl' },
    { id: '2', format: 'LP' },
    { id: '3', format: 'CD-R' },
  ];
  const grouped = groupReleasesByFormatBucket(releases);
  assert.deepEqual(
    grouped.map((g) => g.bucket),
    ['Vinyl', 'CD'],
  );
  assert.deepEqual(
    grouped[0].releases.map((r) => r.format),
    ['12" Vinyl', 'LP'],
  );
  assert.deepEqual(
    grouped[1].releases.map((r) => r.format),
    ['CD-R'],
  );
});

test('groupReleasesByFormatBucket buckets releases with no format under "Unknown"', () => {
  const grouped = groupReleasesByFormatBucket<{ id: string; format?: string }>([{ id: '1' }]);
  assert.deepEqual(grouped, [{ bucket: 'Unknown', releases: [{ id: '1' }] }]);
});

test('loadStoredFilterState returns {} when window is undefined (SSR/test guard)', () => {
  assert.deepEqual(loadStoredFilterState('some-key'), {});
});

test('loadStoredFilterState reads booleans from localStorage and drops non-boolean values', async () => {
  const store = new Map<string, string>();
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  };
  store.set('test-key', JSON.stringify({ Vinyl: false, CD: true, Cassette: 'not-a-boolean', Unknown: 1 }));

  (globalThis as { window?: unknown }).window = fakeWindow;
  try {
    assert.deepEqual(loadStoredFilterState('test-key'), { Vinyl: false, CD: true });
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test('loadStoredFilterState returns {} for missing keys or invalid JSON', () => {
  const fakeWindow = {
    localStorage: {
      getItem: () => 'not valid json',
      setItem: () => undefined,
    },
  };

  (globalThis as { window?: unknown }).window = fakeWindow;
  try {
    assert.deepEqual(loadStoredFilterState('broken-key'), {});
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});
