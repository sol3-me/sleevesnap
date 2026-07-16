import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEMO_PHASE_MS, advanceDemo } from './landingDemo.js';

test('scanning advances to snap on the same album', () => {
  assert.deepEqual(advanceDemo({ phase: 'scanning', albumIndex: 1 }, 3), {
    phase: 'snap',
    albumIndex: 1,
  });
});

test('snap advances to result on the same album', () => {
  assert.deepEqual(advanceDemo({ phase: 'snap', albumIndex: 2 }, 3), {
    phase: 'result',
    albumIndex: 2,
  });
});

test('result advances to scanning the next album', () => {
  assert.deepEqual(advanceDemo({ phase: 'result', albumIndex: 0 }, 3), {
    phase: 'scanning',
    albumIndex: 1,
  });
});

test('the album index wraps back to the first album', () => {
  assert.deepEqual(advanceDemo({ phase: 'result', albumIndex: 2 }, 3), {
    phase: 'scanning',
    albumIndex: 0,
  });
});

test('a single-album demo keeps cycling album 0', () => {
  assert.deepEqual(advanceDemo({ phase: 'result', albumIndex: 0 }, 1), {
    phase: 'scanning',
    albumIndex: 0,
  });
});

test('every phase has a positive duration', () => {
  for (const [phase, ms] of Object.entries(DEMO_PHASE_MS)) {
    assert.ok(ms > 0, `expected ${phase} duration > 0, got ${ms}`);
  }
});
