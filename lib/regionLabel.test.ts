import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasRealFlagIcon, getRegionLabel, listRegionOptions } from './regionLabel';

test('getRegionLabel returns undefined for an absent code', () => {
  assert.equal(getRegionLabel(undefined), undefined);
  assert.equal(getRegionLabel(''), undefined);
});

test('getRegionLabel special-cases MusicBrainz pseudo-regions', () => {
  assert.equal(getRegionLabel('XE'), 'Europe (XE)');
  assert.equal(getRegionLabel('XW'), 'Worldwide (XW)');
  assert.equal(getRegionLabel('XG'), 'East Germany (XG)');
});

test('getRegionLabel resolves real ISO codes via Intl.DisplayNames', () => {
  assert.equal(getRegionLabel('US'), 'United States (US)');
  assert.equal(getRegionLabel('GB'), 'United Kingdom (GB)');
});

test('getRegionLabel falls back to the raw code when it cannot be resolved', () => {
  assert.equal(getRegionLabel('ZZ_NOT_REAL'), 'ZZ_NOT_REAL');
});

test('listRegionOptions includes the MusicBrainz pseudo-regions with their special labels', () => {
  const options = listRegionOptions();
  const byCode = new Map(options.map((o) => [o.code, o.label]));
  assert.equal(byCode.get('XW'), 'Worldwide (XW)');
  assert.equal(byCode.get('XE'), 'Europe (XE)');
  assert.equal(byCode.get('XG'), 'East Germany (XG)');
});

test('listRegionOptions includes real countries', () => {
  const options = listRegionOptions();
  assert.ok(options.some((o) => o.code === 'US' && o.label === 'United States (US)'));
  assert.ok(options.some((o) => o.code === 'JP' && o.label === 'Japan (JP)'));
});

test('listRegionOptions has no duplicate codes and is sorted by label', () => {
  const options = listRegionOptions();
  const codes = options.map((o) => o.code);
  assert.equal(new Set(codes).size, codes.length);

  const labels = options.map((o) => o.label);
  const sorted = [...labels].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(labels, sorted);
});

test('hasRealFlagIcon is true for a real 2-letter ISO code, in either case', () => {
  assert.equal(hasRealFlagIcon('GB'), true);
  assert.equal(hasRealFlagIcon('jp'), true);
});

test('hasRealFlagIcon is false for MusicBrainz pseudo-regions (no real flag exists)', () => {
  assert.equal(hasRealFlagIcon('XW'), false);
  assert.equal(hasRealFlagIcon('XE'), false);
  assert.equal(hasRealFlagIcon('XG'), false);
});

test('hasRealFlagIcon is false for malformed input', () => {
  assert.equal(hasRealFlagIcon('usa'), false);
  assert.equal(hasRealFlagIcon(''), false);
  assert.equal(hasRealFlagIcon('1G'), false);
});
