import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bucketForFormat,
  classifyFormatFamily,
  groupReleasesByFormatBucket,
  groupReleasesByFormatAndYear,
  loadStoredFilterState,
  pickRepresentativeRelease,
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

// --- groupReleasesByFormatAndYear -------------------------------------------
// Collapses near-duplicate regional pressings (same format, same year, only
// the country/label/edition differ) into one variant group, so a popular
// album's expanded release list isn't 15 near-identical country variants.

interface TestRelease {
  id: string;
  format?: string;
  year?: string;
  country?: string;
  releaseDate?: string;
}

test('groupReleasesByFormatAndYear collapses releases sharing the exact format + year', () => {
  const releases: TestRelease[] = [
    { id: 'us', format: 'CD', year: '1988', country: 'US' },
    { id: 'gb', format: 'CD', year: '1988', country: 'GB' },
    { id: 'de', format: 'CD', year: '1988', country: 'DE' },
  ];
  const grouped = groupReleasesByFormatAndYear(releases);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].releases.length, 3);
});

test('groupReleasesByFormatAndYear keeps different exact formats separate even in the same coarse bucket', () => {
  // "12\" Vinyl" and "7\" Vinyl" both bucket to "Vinyl" for the filter dropdown,
  // but they're physically different releases and must not collapse together.
  const releases: TestRelease[] = [
    { id: 'a', format: '12" Vinyl', year: '1988', country: 'US' },
    { id: 'b', format: '7" Vinyl', year: '1988', country: 'US' },
  ];
  const grouped = groupReleasesByFormatAndYear(releases);
  assert.equal(grouped.length, 2);
});

test('groupReleasesByFormatAndYear keeps the same format separate across different years', () => {
  const releases: TestRelease[] = [
    { id: 'a', format: 'CD', year: '1988', country: 'US' },
    { id: 'b', format: 'CD', year: '2011', country: 'US' },
  ];
  const grouped = groupReleasesByFormatAndYear(releases);
  assert.equal(grouped.length, 2);
});

test('groupReleasesByFormatAndYear picks the Worldwide (XW) release as representative regardless of list order', () => {
  const releases: TestRelease[] = [
    { id: 'us', format: 'CD', year: '2005', country: 'US' },
    { id: 'xw', format: 'CD', year: '2005', country: 'XW' },
    { id: 'gb', format: 'CD', year: '2005', country: 'GB' },
  ];
  const [group] = groupReleasesByFormatAndYear(releases);
  assert.equal(group.representative.id, 'xw');
});

test('groupReleasesByFormatAndYear falls back to the earliest releaseDate when there is no Worldwide release', () => {
  const releases: TestRelease[] = [
    { id: 'later', format: 'CD', year: '2005', country: 'US', releaseDate: '2005-06-01' },
    { id: 'earliest', format: 'CD', year: '2005', country: 'GB', releaseDate: '2005-01-15' },
  ];
  const [group] = groupReleasesByFormatAndYear(releases);
  assert.equal(group.representative.id, 'earliest');
});

test('groupReleasesByFormatAndYear falls back to first-in-list order when nothing else differentiates', () => {
  const releases: TestRelease[] = [
    { id: 'first', format: 'CD', year: '2005', country: 'US' },
    { id: 'second', format: 'CD', year: '2005', country: 'GB' },
  ];
  const [group] = groupReleasesByFormatAndYear(releases);
  assert.equal(group.representative.id, 'first');
});

test('groupReleasesByFormatAndYear buckets releases missing format/year under "Unknown"', () => {
  const releases: TestRelease[] = [{ id: 'a' }, { id: 'b' }];
  const grouped = groupReleasesByFormatAndYear(releases);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].format, 'Unknown');
  assert.equal(grouped[0].year, 'Unknown');
  assert.equal(grouped[0].releases.length, 2);
});

test('groupReleasesByFormatAndYear preserves first-appearance order of variant groups', () => {
  const releases: TestRelease[] = [
    { id: 'a', format: 'CD', year: '2011', country: 'US' },
    { id: 'b', format: 'CD', year: '1988', country: 'US' },
    { id: 'c', format: 'CD', year: '2011', country: 'GB' },
  ];
  const grouped = groupReleasesByFormatAndYear(releases);
  assert.deepEqual(
    grouped.map((g) => g.year),
    ['2011', '1988'],
  );
});

// --- classifyFormatFamily ----------------------------------------------
// Generalizes the same substring patterns ReleaseGroupResultsList's
// getFormatIcon already used for icon selection, so "which format family is
// this" has one source of truth shared by icon lookup and preference
// matching (see pickRepresentativeRelease below).

test('classifyFormatFamily recognises Vinyl variants', () => {
  assert.equal(classifyFormatFamily('12" Vinyl'), 'Vinyl');
  assert.equal(classifyFormatFamily('LP'), 'Vinyl');
  assert.equal(classifyFormatFamily('7" Vinyl'), 'Vinyl');
});

test('classifyFormatFamily recognises CD variants', () => {
  assert.equal(classifyFormatFamily('CD'), 'CD');
  assert.equal(classifyFormatFamily('2xCD'), 'CD');
});

test('classifyFormatFamily recognises Cassette variants', () => {
  assert.equal(classifyFormatFamily('Cassette'), 'Cassette');
  assert.equal(classifyFormatFamily('Tape'), 'Cassette');
});

test('classifyFormatFamily recognises Digital Media', () => {
  assert.equal(classifyFormatFamily('Digital Media'), 'Digital Media');
});

test('classifyFormatFamily recognises DVD/Blu-ray variants', () => {
  assert.equal(classifyFormatFamily('DVD-Video'), 'DVD/Blu-ray');
  assert.equal(classifyFormatFamily('Blu-ray'), 'DVD/Blu-ray');
});

test('classifyFormatFamily falls back to "Other" for unrecognised or missing formats', () => {
  assert.equal(classifyFormatFamily('SACD'), 'Other');
  assert.equal(classifyFormatFamily(undefined), 'Other');
});

// --- pickRepresentativeRelease with preferences -------------------------

interface PreferenceTestRelease {
  id: string;
  format?: string;
  country?: string;
  releaseDate?: string;
}

test('pickRepresentativeRelease with no preferences behaves exactly as before (Worldwide > earliest date > first)', () => {
  const releases: PreferenceTestRelease[] = [
    { id: 'us', format: 'CD', country: 'US', releaseDate: '2005-01-01' },
    { id: 'xw', format: 'CD', country: 'XW', releaseDate: '2005-06-01' },
  ];
  assert.equal(pickRepresentativeRelease(releases).id, 'xw');
});

test('pickRepresentativeRelease prefers a release matching preferredFormat over one that does not', () => {
  const releases: PreferenceTestRelease[] = [
    { id: 'cd-worldwide', format: 'CD', country: 'XW' },
    { id: 'vinyl-us', format: '12" Vinyl', country: 'US' },
  ];
  const result = pickRepresentativeRelease(releases, { preferredFormat: 'Vinyl' });
  assert.equal(result.id, 'vinyl-us');
});

test('pickRepresentativeRelease falls back to all releases when none match preferredFormat', () => {
  const releases: PreferenceTestRelease[] = [
    { id: 'cd-worldwide', format: 'CD', country: 'XW' },
    { id: 'cd-us', format: 'CD', country: 'US' },
  ];
  const result = pickRepresentativeRelease(releases, { preferredFormat: 'Cassette' });
  assert.equal(result.id, 'cd-worldwide', 'no Cassette exists for this group, so the usual default applies');
});

test('pickRepresentativeRelease prefers a release matching preferredRegion over the Worldwide default', () => {
  const releases: PreferenceTestRelease[] = [
    { id: 'xw', format: 'CD', country: 'XW' },
    { id: 'jp', format: 'CD', country: 'JP' },
  ];
  const result = pickRepresentativeRelease(releases, { preferredRegion: 'JP' });
  assert.equal(result.id, 'jp');
});

test('pickRepresentativeRelease falls back to the default priority when preferredRegion has no match', () => {
  const releases: PreferenceTestRelease[] = [
    { id: 'xw', format: 'CD', country: 'XW' },
    { id: 'us', format: 'CD', country: 'US' },
  ];
  const result = pickRepresentativeRelease(releases, { preferredRegion: 'JP' });
  assert.equal(result.id, 'xw', 'no JP pressing exists, so the usual Worldwide default applies');
});

test('pickRepresentativeRelease applies preferredFormat first, then preferredRegion within that format', () => {
  const releases: PreferenceTestRelease[] = [
    { id: 'cd-jp', format: 'CD', country: 'JP' },
    { id: 'vinyl-us', format: '12" Vinyl', country: 'US' },
    { id: 'vinyl-jp', format: '12" Vinyl', country: 'JP' },
  ];
  const result = pickRepresentativeRelease(releases, { preferredFormat: 'Vinyl', preferredRegion: 'JP' });
  assert.equal(result.id, 'vinyl-jp');
});

test('pickRepresentativeRelease keeps the preferredFormat filter even when preferredRegion has no match within it', () => {
  const releases: PreferenceTestRelease[] = [
    { id: 'cd-jp', format: 'CD', country: 'JP' },
    { id: 'vinyl-us', format: '12" Vinyl', country: 'US' },
    { id: 'vinyl-xw', format: '12" Vinyl', country: 'XW' },
  ];
  const result = pickRepresentativeRelease(releases, { preferredFormat: 'Vinyl', preferredRegion: 'JP' });
  assert.equal(
    result.id,
    'vinyl-xw',
    'no Vinyl+JP pressing exists, so it stays within Vinyl and falls back to the Worldwide default',
  );
});

// --- groupReleasesByFormatAndYear with preferences -----------------------

test('groupReleasesByFormatAndYear picks the preferredRegion release as representative when present in the group', () => {
  const releases: TestRelease[] = [
    { id: 'xw', format: 'CD', year: '2005', country: 'XW' },
    { id: 'jp', format: 'CD', year: '2005', country: 'JP' },
  ];
  const [group] = groupReleasesByFormatAndYear(releases, { preferredRegion: 'JP' });
  assert.equal(group.representative.id, 'jp');
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
