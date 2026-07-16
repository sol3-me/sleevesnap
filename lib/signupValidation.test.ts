import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateAuthFields } from './signupValidation.js';

// ── email ────────────────────────────────────────────────────────────────

test('validateAuthFields flags an empty email', () => {
  const errors = validateAuthFields('', 'pw123456', 'sign-in');
  assert.equal(errors.email, 'Email is required.');
});

test('validateAuthFields flags a malformed email', () => {
  const errors = validateAuthFields('not-an-email', 'pw123456', 'sign-in');
  assert.equal(errors.email, "That doesn't look like a valid email address.");
});

test('validateAuthFields accepts a well-formed email', () => {
  const errors = validateAuthFields('ben@example.com', 'pw123456', 'sign-in');
  assert.equal(errors.email, undefined);
});

// ── password ─────────────────────────────────────────────────────────────

test('validateAuthFields flags an empty password', () => {
  const errors = validateAuthFields('ben@example.com', '', 'sign-in');
  assert.equal(errors.password, 'Password is required.');
});

test('validateAuthFields flags a too-short password on sign-up', () => {
  const errors = validateAuthFields('ben@example.com', 'abc12', 'sign-up');
  assert.equal(errors.password, 'Password needs to be at least 6 characters.');
});

test('validateAuthFields does not enforce the length minimum on sign-in', () => {
  // an existing account could predate the current minimum length rule
  const errors = validateAuthFields('ben@example.com', 'abc12', 'sign-in');
  assert.equal(errors.password, undefined);
});

test('validateAuthFields accepts a 6+ character password on sign-up', () => {
  const errors = validateAuthFields('ben@example.com', 'abc123', 'sign-up');
  assert.equal(errors.password, undefined);
});

test('validateAuthFields returns no errors for valid sign-up input', () => {
  const errors = validateAuthFields('ben@example.com', 'abc123', 'sign-up');
  assert.deepEqual(errors, {});
});
