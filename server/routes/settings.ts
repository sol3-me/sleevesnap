import { Router, type Request, type Response } from 'express';
import { db } from '../db.js';

export const settingsRouter = Router();

const VALID_CARD_SIZES = ['S', 'M', 'L'] as const;
type CardSize = (typeof VALID_CARD_SIZES)[number];

function isValidCardSize(value: unknown): value is CardSize {
  return typeof value === 'string' && (VALID_CARD_SIZES as readonly string[]).includes(value);
}

interface UserSettingsRow {
  user_id: string;
  card_size: string;
}

// Routes below assume the auth middleware ran; a missing user is a server
// wiring mistake, not a client error, but answering 401 keeps data safe.
function requireUid(req: Request, res: Response): string | undefined {
  const uid = req.user?.uid;
  if (!uid) {
    res.status(401).json({ error: 'Authentication required' });
  }
  return uid;
}

// GET /api/settings – a user with no row yet just hasn't changed anything
// from the default, so this returns the default rather than 404ing.
settingsRouter.get('/', (req, res) => {
  const uid = requireUid(req, res);
  if (!uid) return;

  const row = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(uid) as
    | UserSettingsRow
    | undefined;
  res.json({ cardSize: row?.card_size ?? 'M' });
});

// PUT /api/settings – partial update; only cardSize exists today.
settingsRouter.put('/', (req, res) => {
  const uid = requireUid(req, res);
  if (!uid) return;

  const { cardSize } = req.body;
  if (!isValidCardSize(cardSize)) {
    res.status(400).json({ error: `cardSize must be one of ${VALID_CARD_SIZES.join(', ')}` });
    return;
  }

  db.prepare(
    `INSERT INTO user_settings (user_id, card_size) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET card_size = excluded.card_size`,
  ).run(uid, cardSize);

  res.json({ cardSize });
});
