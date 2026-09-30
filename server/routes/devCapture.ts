import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_REPORT_PATH = path.join(process.cwd(), 'dev-capture-report.json');

/**
 * Dev-only round-trip for the auto-capture test harness (views/DevCaptureTesting.tsx):
 * a mobile device runs detection and POSTs its JSON report here; a PC on the
 * same network GETs it back to view the same results. No auth — see
 * server/index.ts, which only registers this router outside production.
 */
export function createDevCaptureRouter(reportFilePath: string = DEFAULT_REPORT_PATH): Router {
  const router = Router();

  router.post('/capture-report', (req: Request, res: Response) => {
    fs.writeFileSync(reportFilePath, JSON.stringify(req.body));
    res.status(200).json({ ok: true });
  });

  router.get('/capture-report', (_req: Request, res: Response) => {
    if (!fs.existsSync(reportFilePath)) {
      res.status(404).json({ error: 'No report saved yet' });
      return;
    }
    res.type('application/json').send(fs.readFileSync(reportFilePath, 'utf8'));
  });

  return router;
}
