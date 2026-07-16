import { Router, type Request, type Response } from 'express';

/**
 * Creates the landing API router. Public (no auth): it serves only covers
 * from the curated landing pool, never user data.
 *
 * @param startWarmup - Invoked (fire-and-forget) on each covers request so
 *                      uncached pool entries get fetched in the background.
 */
export function createLandingRouter(startWarmup: () => void): Router {
  const router = Router();

  router.get('/covers', (_req: Request, res: Response) => {
    void startWarmup;
    res.status(501).json({ error: 'not implemented' });
  });

  return router;
}
