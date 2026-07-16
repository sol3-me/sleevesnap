import assert from 'node:assert/strict';
import { FirebaseError } from 'firebase/app';
import { test } from 'node:test';
import { describeAuthFieldError } from './authErrors.js';

function firebaseError(code: string): FirebaseError {
  return new FirebaseError(code, code);
}

test('describeAuthFieldError attributes an already-in-use email to the email field', () => {
  const result = describeAuthFieldError(firebaseError('auth/email-already-in-use'));
  assert.equal(result?.field, 'email');
  assert.equal(result?.message, 'An account with this email already exists — try signing in instead.');
});

test('describeAuthFieldError attributes an invalid email to the email field', () => {
  const result = describeAuthFieldError(firebaseError('auth/invalid-email'));
  assert.equal(result?.field, 'email');
});

test('describeAuthFieldError attributes a weak password to the password field', () => {
  const result = describeAuthFieldError(firebaseError('auth/weak-password'));
  assert.equal(result?.field, 'password');
});

test('describeAuthFieldError attributes wrong credentials to the password field', () => {
  const result = describeAuthFieldError(firebaseError('auth/wrong-password'));
  assert.equal(result?.field, 'password');
});

test('describeAuthFieldError treats a user-cancelled popup as no error at all', () => {
  const result = describeAuthFieldError(firebaseError('auth/popup-closed-by-user'));
  assert.equal(result, null);
});

test('describeAuthFieldError leaves account-wide errors unattributed to any field', () => {
  const result = describeAuthFieldError(firebaseError('auth/too-many-requests'));
  assert.equal(result?.field, null);
  assert.equal(result?.message, 'Too many attempts — wait a moment and try again.');
});

test('describeAuthFieldError falls back to a generic message for unknown errors', () => {
  const result = describeAuthFieldError(new Error('network down'));
  assert.equal(result?.field, null);
  assert.equal(result?.message, 'Sign-in failed. Please try again.');
});
