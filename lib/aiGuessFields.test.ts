import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ScanVisionSuggestion } from '../types.js';
import {
  bestGuess,
  confidenceTier,
  confidenceTierLabel,
  fieldAlternates,
  guessToFields,
  rankGuesses,
} from './aiGuessFields.js';

function guess(overrides: Partial<ScanVisionSuggestion>): ScanVisionSuggestion {
  return {
    artist: 'Some Artist',
    title: 'Some Title',
    confidence: 0.5,
    ...overrides,
  };
}

// ── confidenceTier ────────────────────────────────────────────────────────────

test('confidenceTier maps the same bands the scanner has always shown', () => {
  assert.equal(confidenceTier(0.95), 'high');
  assert.equal(confidenceTier(0.85), 'high');
  assert.equal(confidenceTier(0.7), 'medium');
  assert.equal(confidenceTier(0.6), 'medium');
  assert.equal(confidenceTier(0.4), 'low');
  assert.equal(confidenceTier(0.35), 'low');
  assert.equal(confidenceTier(0.1), 'guess');
  assert.equal(confidenceTier(undefined), 'guess');
});

test('confidenceTier clamps out-of-range values instead of misbanding them', () => {
  assert.equal(confidenceTier(1.5), 'high');
  assert.equal(confidenceTier(-0.2), 'guess');
});

test('confidenceTierLabel gives each band a human-readable label', () => {
  assert.equal(confidenceTierLabel('high'), 'High');
  assert.equal(confidenceTierLabel('medium'), 'Medium');
  assert.equal(confidenceTierLabel('low'), 'Low');
  assert.equal(confidenceTierLabel('guess'), 'Total Guess');
});

// ── rankGuesses / bestGuess ───────────────────────────────────────────────────

test('rankGuesses puts validated guesses ahead of higher-confidence unvalidated ones', () => {
  const unvalidatedHigh = guess({ title: 'Confidently Wrong', confidence: 0.99, validated: false });
  const validatedLower = guess({ title: 'Actually Real', confidence: 0.6, validated: true });

  const ranked = rankGuesses([unvalidatedHigh, validatedLower]);

  assert.equal(ranked[0]?.title, 'Actually Real');
  assert.equal(ranked[1]?.title, 'Confidently Wrong');
});

test('rankGuesses orders by confidence within the same validation state', () => {
  const a = guess({ title: 'A', confidence: 0.4, validated: true });
  const b = guess({ title: 'B', confidence: 0.9, validated: true });
  const c = guess({ title: 'C', confidence: 0.7, validated: false });
  const d = guess({ title: 'D', confidence: 0.95, validated: false });

  const ranked = rankGuesses([a, b, c, d]);

  assert.deepEqual(ranked.map((g) => g.title), ['B', 'A', 'D', 'C']);
});

test('rankGuesses treats a missing validated flag as unvalidated (older scan-history entries)', () => {
  const legacy = guess({ title: 'Legacy', confidence: 0.99 });
  const validated = guess({ title: 'Validated', confidence: 0.5, validated: true });

  const ranked = rankGuesses([legacy, validated]);

  assert.equal(ranked[0]?.title, 'Validated');
});

test('rankGuesses does not mutate its input', () => {
  const input = [
    guess({ title: 'First', confidence: 0.1 }),
    guess({ title: 'Second', confidence: 0.9 }),
  ];
  rankGuesses(input);
  assert.deepEqual(input.map((g) => g.title), ['First', 'Second']);
});

test('bestGuess returns the top-ranked guess, or undefined when there are none', () => {
  const winner = guess({ title: 'Winner', confidence: 0.5, validated: true });
  const loser = guess({ title: 'Loser', confidence: 0.9, validated: false });

  assert.equal(bestGuess([loser, winner])?.title, 'Winner');
  assert.equal(bestGuess([]), undefined);
});

// ── guessToFields ─────────────────────────────────────────────────────────────

test('guessToFields maps guess fields onto the search fields, leaving label empty', () => {
  const fields = guessToFields(guess({ artist: 'King Gizzard', title: 'Laminated Denim', year: '2022' }));
  assert.deepEqual(fields, { title: 'Laminated Denim', artist: 'King Gizzard', year: '2022', label: '' });
});

test('guessToFields turns a missing year into an empty string', () => {
  const fields = guessToFields(guess({ artist: 'A', title: 'T', year: undefined }));
  assert.equal(fields.year, '');
});

// ── fieldAlternates ───────────────────────────────────────────────────────────

test('fieldAlternates lists other guesses\' values for a field, excluding the current value', () => {
  const guesses = [
    guess({ title: 'Laminated Denim', confidence: 0.9, validated: true }),
    guess({ title: 'Made in Timeland', confidence: 0.7, validated: true }),
    guess({ title: 'Hypertension', confidence: 0.3, validated: false }),
  ];

  const alternates = fieldAlternates(guesses, 'title', 'Laminated Denim');

  assert.deepEqual(alternates.map((a) => a.value), ['Made in Timeland', 'Hypertension']);
  assert.equal(alternates[0]?.validated, true);
  assert.equal(alternates[0]?.confidence, 0.7);
  assert.equal(alternates[1]?.validated, false);
});

test('fieldAlternates deduplicates identical values, keeping the strongest annotation', () => {
  const guesses = [
    guess({ artist: 'King Gizzard & The Lizard Wizard', confidence: 0.9, validated: false }),
    guess({ artist: 'King Gizzard & The Lizard Wizard', confidence: 0.6, validated: true }),
    guess({ artist: 'King Lizard', confidence: 0.3, validated: false }),
  ];

  const alternates = fieldAlternates(guesses, 'artist', 'Someone Else');

  assert.equal(alternates.length, 2);
  const kg = alternates.find((a) => a.value === 'King Gizzard & The Lizard Wizard');
  assert.equal(kg?.validated, true, 'the validated duplicate must win over the higher-confidence unvalidated one');
});

test('fieldAlternates skips guesses with no value for the field', () => {
  const guesses = [
    guess({ title: 'Has Year', year: '2022', confidence: 0.9 }),
    guess({ title: 'No Year', year: undefined, confidence: 0.8 }),
    guess({ title: 'Empty Year', year: '', confidence: 0.7 }),
  ];

  const alternates = fieldAlternates(guesses, 'year', '');

  assert.deepEqual(alternates.map((a) => a.value), ['2022']);
});

test('fieldAlternates orders by guess rank (validated first, then confidence)', () => {
  const guesses = [
    guess({ title: 'Unvalidated High', confidence: 0.95, validated: false }),
    guess({ title: 'Validated Low', confidence: 0.4, validated: true }),
  ];

  const alternates = fieldAlternates(guesses, 'title', 'Current');

  assert.deepEqual(alternates.map((a) => a.value), ['Validated Low', 'Unvalidated High']);
});
