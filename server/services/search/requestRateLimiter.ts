export interface RateLimiter {
  schedule<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Serializes calls so each one's *dispatch* (start) is spaced at least
 * minIntervalMs after the previous dispatch — regardless of how long any
 * individual call takes to resolve. Matches rate-limit policies expressed as
 * "N requests per second" (e.g. MusicBrainz's ~1/sec per IP), which count
 * when a request starts, not how long it runs — so a slow call in flight
 * doesn't hold up the next one's scheduled start time.
 */
export function createRateLimiter(minIntervalMs: number): RateLimiter {
  let lastDispatch = 0;
  // Chained promise representing "your turn to dispatch has arrived" for
  // whichever call is next in line. Deliberately not chained to each call's
  // fn() — a slow or rejected fn must not affect when the next call dispatches.
  let queue: Promise<void> = Promise.resolve();

  function schedule<T>(fn: () => Promise<T>): Promise<T> {
    const turn = queue.then(async () => {
      const wait = Math.max(0, lastDispatch + minIntervalMs - Date.now());
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      lastDispatch = Date.now();
    });

    queue = turn;
    return turn.then(fn);
  }

  return { schedule };
}
