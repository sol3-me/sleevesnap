import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  detectRegionFromLocale,
  detectRegionFromLocales,
  FALLBACK_REGION,
  resolveEffectivePreferredRegion,
} from './detectRegionFromLocale';

test('detectRegionFromLocale extracts a simple language-region tag', () => {
  assert.equal(detectRegionFromLocale('en-GB'), 'GB');
  assert.equal(detectRegionFromLocale('fr-FR'), 'FR');
});

test('detectRegionFromLocale returns undefined when there is no region subtag', () => {
  assert.equal(detectRegionFromLocale('en'), undefined);
});

test('detectRegionFromLocale skips a script subtag to find the region', () => {
  // language-Script-REGION, e.g. Chinese written in Simplified script, region China
  assert.equal(detectRegionFromLocale('zh-Hans-CN'), 'CN');
});

test('detectRegionFromLocale returns undefined for an absent locale', () => {
  assert.equal(detectRegionFromLocale(undefined), undefined);
});

test('detectRegionFromLocales returns the first locale in the list with a resolvable region', () => {
  assert.equal(detectRegionFromLocales(['en', 'fr-FR', 'en-GB']), 'FR');
});

test('detectRegionFromLocales returns undefined when nothing in the list has a region', () => {
  assert.equal(detectRegionFromLocales(['en', 'fr', 'de']), undefined);
});

test('detectRegionFromLocales returns undefined for an empty or absent list', () => {
  assert.equal(detectRegionFromLocales([]), undefined);
  assert.equal(detectRegionFromLocales(undefined), undefined);
});

test('resolveEffectivePreferredRegion prefers an explicit preference over detection', () => {
  assert.equal(resolveEffectivePreferredRegion('JP', ['en-GB']), 'JP');
});

test('resolveEffectivePreferredRegion falls back to browser-locale detection when unset', () => {
  assert.equal(resolveEffectivePreferredRegion(null, ['fr-FR']), 'FR');
});

test('resolveEffectivePreferredRegion falls back to the UK default when nothing else resolves', () => {
  assert.equal(resolveEffectivePreferredRegion(null, []), FALLBACK_REGION);
  assert.equal(resolveEffectivePreferredRegion(null, undefined), FALLBACK_REGION);
  assert.equal(resolveEffectivePreferredRegion(undefined, ['en']), FALLBACK_REGION);
  assert.equal(FALLBACK_REGION, 'GB');
});
