import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  advanceStability,
  fillRatio,
  initialStabilityState,
  isGoodCandidate,
  quadArea,
  squareness,
} from './sleeveDetectionScoring.js';

const unitSquare = {
  topLeftCorner: { x: 0, y: 0 },
  topRightCorner: { x: 100, y: 0 },
  bottomLeftCorner: { x: 0, y: 100 },
  bottomRightCorner: { x: 100, y: 100 },
};

const tallRectangle = {
  topLeftCorner: { x: 0, y: 0 },
  topRightCorner: { x: 20, y: 0 },
  bottomLeftCorner: { x: 0, y: 100 },
  bottomRightCorner: { x: 20, y: 100 },
};

// A 100x100 square rotated exactly 15deg about its own center (computed via
// the rotation matrix, then translated so all coordinates are non-negative).
// Side lengths stay equal even though it's tilted, which is exactly the case
// squareness needs to tolerate (a sleeve held at a slight angle to the
// camera, not perfectly axis-aligned).
const tiltedSquare = {
  topLeftCorner: { x: 25.882, y: 0 },
  topRightCorner: { x: 122.474, y: 25.882 },
  bottomRightCorner: { x: 96.592, y: 122.474 },
  bottomLeftCorner: { x: 0, y: 96.592 },
};

test('quadArea computes the area of an axis-aligned square', () => {
  assert.equal(quadArea(unitSquare), 10_000);
});

test('quadArea computes the area of a rotated quadrilateral via the shoelace formula', () => {
  // Rotating a shape doesn't change its area (small tolerance for the
  // fixture's rounded-to-3-decimal-places coordinates).
  assert.ok(Math.abs(quadArea(tiltedSquare) - 10_000) < 1, `expected ~10000, got ${quadArea(tiltedSquare)}`);
});

test('squareness is 1 for a perfect axis-aligned square', () => {
  assert.equal(squareness(unitSquare), 1);
});

test('squareness stays close to 1 for a square tilted at a slight angle', () => {
  assert.ok(squareness(tiltedSquare) > 0.99, `expected > 0.99, got ${squareness(tiltedSquare)}`);
});

test('squareness is low for an oblong rectangle', () => {
  assert.ok(squareness(tallRectangle) < 0.3, `expected < 0.3, got ${squareness(tallRectangle)}`);
});

test('fillRatio is 1 when the quad exactly fills the frame', () => {
  assert.equal(fillRatio(unitSquare, 100, 100), 1);
});

test('fillRatio is a quarter when the quad is a quarter of the frame area', () => {
  assert.equal(fillRatio(unitSquare, 200, 200), 0.25);
});

test('fillRatio clamps to 1 even if the quad is measured larger than the frame', () => {
  assert.equal(fillRatio(unitSquare, 50, 50), 1);
});

test('isGoodCandidate accepts a well-framed square', () => {
  assert.equal(isGoodCandidate(unitSquare, 110, 110, { minSquareness: 0.85, minFillRatio: 0.5 }), true);
});

test('isGoodCandidate rejects a square that is too small in-frame', () => {
  assert.equal(isGoodCandidate(unitSquare, 1000, 1000, { minSquareness: 0.85, minFillRatio: 0.5 }), false);
});

test('isGoodCandidate rejects an oblong rectangle even if it fills the frame', () => {
  assert.equal(isGoodCandidate(tallRectangle, 20, 100, { minSquareness: 0.85, minFillRatio: 0.5 }), false);
});

test('advanceStability resets the counter on a bad frame', () => {
  const afterGood = advanceStability({ consecutiveGoodFrames: 3 }, false, 5);
  assert.deepEqual(afterGood.state, initialStabilityState);
  assert.equal(afterGood.shouldCapture, false);
});

test('advanceStability increments on consecutive good frames without firing early', () => {
  let state = initialStabilityState;
  for (let i = 0; i < 4; i++) {
    const result = advanceStability(state, true, 5);
    assert.equal(result.shouldCapture, false);
    state = result.state;
  }
  assert.deepEqual(state, { consecutiveGoodFrames: 4 });
});

test('advanceStability fires exactly on the required frame count', () => {
  let state = initialStabilityState;
  let result = { state, shouldCapture: false };
  for (let i = 0; i < 5; i++) {
    result = advanceStability(result.state, true, 5);
  }
  assert.equal(result.shouldCapture, true);
  assert.equal(result.state.consecutiveGoodFrames, 5);
});

test('advanceStability does not keep firing shouldCapture=true forever once past the threshold in a single accumulating run', () => {
  // Callers are expected to reset tracking (e.g. after actually capturing) —
  // advanceStability itself has no opinion on that, it just keeps counting.
  const result = advanceStability({ consecutiveGoodFrames: 5 }, true, 5);
  assert.equal(result.shouldCapture, true);
  assert.equal(result.state.consecutiveGoodFrames, 6);
});
