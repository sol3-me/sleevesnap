/**
 * Pure scoring logic for the camera's auto-capture heuristic (see
 * auto-capture-research.md). Detection itself (finding the quad in a video
 * frame) is jscanify/OpenCV.js's job — lib/sleeveDetector.ts wraps that; this
 * module only judges *how good* a detected quad is and *when* to fire,
 * independent of any camera/canvas/WASM machinery so it can be unit tested.
 */

export type Point = { x: number; y: number };

export type Corners = {
  topLeftCorner: Point;
  topRightCorner: Point;
  bottomLeftCorner: Point;
  bottomRightCorner: Point;
};

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Shoelace formula, in corner-walk order (top-left → top-right → bottom-right → bottom-left). */
export function quadArea(corners: Corners): number {
  const { topLeftCorner: tl, topRightCorner: tr, bottomRightCorner: br, bottomLeftCorner: bl } = corners;
  const points = [tl, tr, br, bl];
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * How close the quad is to a square, from 0 (not square at all) to 1
 * (perfect square). Compares side lengths only (shortest / longest), not
 * axis-alignment — a square held at a slight tilt to the camera still has
 * four roughly-equal sides, and tilt tolerance is exactly what's needed for
 * a handheld sleeve that isn't perfectly parallel to the lens.
 */
export function squareness(corners: Corners): number {
  const { topLeftCorner: tl, topRightCorner: tr, bottomRightCorner: br, bottomLeftCorner: bl } = corners;
  const sides = [distance(tl, tr), distance(tr, br), distance(br, bl), distance(bl, tl)];
  const shortest = Math.min(...sides);
  const longest = Math.max(...sides);
  if (longest === 0) return 0;
  return shortest / longest;
}

/** Fraction of the frame's area the quad covers, clamped to [0, 1]. */
export function fillRatio(corners: Corners, frameWidth: number, frameHeight: number): number {
  const frameArea = frameWidth * frameHeight;
  if (frameArea <= 0) return 0;
  return Math.min(quadArea(corners) / frameArea, 1);
}

export type CandidateThresholds = {
  minSquareness: number;
  minFillRatio: number;
};

/** Single-frame pass/fail: is this quad square enough and large enough to be a candidate sleeve? */
export function isGoodCandidate(
  corners: Corners,
  frameWidth: number,
  frameHeight: number,
  thresholds: CandidateThresholds,
): boolean {
  return (
    squareness(corners) >= thresholds.minSquareness &&
    fillRatio(corners, frameWidth, frameHeight) >= thresholds.minFillRatio
  );
}

export type StabilityState = { consecutiveGoodFrames: number };

export const initialStabilityState: StabilityState = { consecutiveGoodFrames: 0 };

/**
 * Advances the "has this been a good candidate for long enough" counter by
 * one sampled frame. A single bad frame resets the streak entirely — a
 * momentary hand wobble shouldn't cost the full stability window, but it
 * does mean the streak has to be genuinely continuous, not just "mostly".
 */
export function advanceStability(
  state: StabilityState,
  isGoodFrame: boolean,
  requiredConsecutiveFrames: number,
): { state: StabilityState; shouldCapture: boolean } {
  if (!isGoodFrame) {
    return { state: initialStabilityState, shouldCapture: false };
  }
  const consecutiveGoodFrames = state.consecutiveGoodFrames + 1;
  return {
    state: { consecutiveGoodFrames },
    shouldCapture: consecutiveGoodFrames >= requiredConsecutiveFrames,
  };
}
