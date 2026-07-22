import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getProviderLabel } from './authProviderLabel';

function makeUser(providerId?: string): any {
  return {
    providerData: providerId ? [{ providerId }] : [],
  };
}

test('getProviderLabel maps google.com to Google', () => {
  assert.equal(getProviderLabel(makeUser('google.com')), 'Google');
});

test('getProviderLabel maps github.com to GitHub', () => {
  assert.equal(getProviderLabel(makeUser('github.com')), 'GitHub');
});

test('getProviderLabel maps password to Email', () => {
  assert.equal(getProviderLabel(makeUser('password')), 'Email');
});

test('getProviderLabel returns null for an unrecognised provider', () => {
  assert.equal(getProviderLabel(makeUser('apple.com')), null);
});

test('getProviderLabel returns null when there is no provider data', () => {
  assert.equal(getProviderLabel(makeUser(undefined)), null);
});
