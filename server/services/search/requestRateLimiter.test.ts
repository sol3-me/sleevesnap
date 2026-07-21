import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRateLimiter } from './requestRateLimiter.js';

test('createRateLimiter runs a single call immediately, with no artificial delay', async () => {
  const limiter = createRateLimiter(200);
  const start = Date.now();
  await limiter.schedule(async () => 'result');
  assert.ok(Date.now() - start < 100, 'a single call should not be delayed');
});

test('createRateLimiter spaces out dispatch of successive calls by at least minIntervalMs', async () => {
  const limiter = createRateLimiter(150);
  const dispatchTimes: number[] = [];

  const calls = [1, 2, 3].map(() =>
    limiter.schedule(async () => {
      dispatchTimes.push(Date.now());
      return undefined;
    }),
  );
  await Promise.all(calls);

  assert.equal(dispatchTimes.length, 3);
  assert.ok(dispatchTimes[1] - dispatchTimes[0] >= 145, `expected >=~150ms gap, got ${dispatchTimes[1] - dispatchTimes[0]}ms`);
  assert.ok(dispatchTimes[2] - dispatchTimes[1] >= 145, `expected >=~150ms gap, got ${dispatchTimes[2] - dispatchTimes[1]}ms`);
});

test('createRateLimiter does not hold up later dispatches behind an earlier call that is slow to resolve', async () => {
  const limiter = createRateLimiter(50);
  const order: string[] = [];

  const slow = limiter.schedule(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    order.push('slow-done');
  });
  // Scheduled right after — should still dispatch ~50ms later, not wait for `slow` to finish.
  const fast = limiter.schedule(async () => {
    order.push('fast-done');
  });

  await fast;
  assert.deepEqual(order, ['fast-done'], 'the fast call should resolve well before the slow one');
  await slow;
});

test("createRateLimiter: one call's rejection does not break scheduling for later calls", async () => {
  const limiter = createRateLimiter(20);

  await assert.rejects(() => limiter.schedule(async () => {
    throw new Error('boom');
  }));

  const result = await limiter.schedule(async () => 'still works');
  assert.equal(result, 'still works');
});
