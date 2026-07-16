import { Router, type Request, type Response } from 'express';
import { getCachedLandingCovers } from '../services/landingCovers.js';
import { LANDING_POOL } from '../services/landingPool.js';

const DEFAULT_COUNT = 24;

/**
 * Creates the landing API router. Public (no auth): it serves only covers
 * from the curated landing pool, never user data.
 *
 * @param startWarmup - Invoked (fire-and-forget) on each covers request so
 *                      uncached pool entries get fetched in the background.
 */
export function createLandingRouter(startWarmup: () => void): Router {
  const router = Router();

  /**
   * GET /api/landing/covers?count=<n>
   *
   * Returns up to `count` (default 24, capped at the pool size) randomly
   * picked covers that are already cached. A cold cache returns an empty
   * list — the client renders placeholder tiles — while the triggered
   * warmup fills the pool in the background.
   */
  router.get('/covers', (req: Request, res: Response) => {
    const raw = Number(req.query.count);
    const requested = Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_COUNT;
    const count = Math.min(Math.max(requested, 1), LANDING_POOL.length);

    startWarmup();
    res.json({ covers: getCachedLandingCovers(count) });
  });

  return router;
}
