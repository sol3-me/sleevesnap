import { Router, type Request, type Response } from 'express';
import { db } from '../db.js';

export const settingsRouter = Router();

const VALID_CARD_SIZES = ['S', 'M', 'L'] as const;
type CardSize = (typeof VALID_CARD_SIZES)[number];

function isValidCardSize(value: unknown): value is CardSize {
  return typeof value === 'string' && (VALID_CARD_SIZES as readonly string[]).includes(value);
}

// Mirrors lib/filters.ts's FORMAT_FAMILY_OPTIONS — kept as its own
// server-side list rather than importing across the client/server
// boundary, same as VALID_CARD_SIZES/CardSize above.
const VALID_PREFERRED_FORMATS = ['Vinyl', 'CD', 'Cassette', 'Digital Media', 'DVD/Blu-ray'];

function isValidPreferredFormat(value: unknown): value is string {
  return typeof value === 'string' && VALID_PREFERRED_FORMATS.includes(value);
}

// MusicBrainz region codes (real ISO 3166-1 alpha-2 codes plus its own
// XW/XE/XG pseudo-codes) are all exactly 2 uppercase letters — no need for a
// hardcoded list server-side, unlike preferredFormat's small closed set.
function isValidPreferredRegion(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value);
}

interface UserSettingsRow {
  user_id: string;
  card_size: string;
  preferred_format: string | null;
  preferred_region: string | null;
}

interface UserSettingsPayload {
  cardSize: CardSize;
  preferredFormat: string | null;
  preferredRegion: string | null;
}

function rowToPayload(row: UserSettingsRow | undefined): UserSettingsPayload {
  return {
    cardSize: (row?.card_size as CardSize | undefined) ?? 'M',
    preferredFormat: row?.preferred_format ?? null,
    preferredRegion: row?.preferred_region ?? null,
  };
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

function readSettingsRow(uid: string): UserSettingsRow | undefined {
  return db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(uid) as UserSettingsRow | undefined;
}

// GET /api/settings – a user with no row yet just hasn't changed anything
// from the defaults, so this returns the defaults rather than 404ing.
settingsRouter.get('/', (req, res) => {
  const uid = requireUid(req, res);
  if (!uid) return;
  res.json(rowToPayload(readSettingsRow(uid)));
});

// PUT /api/settings – partial update: any subset of cardSize/preferredFormat/
// preferredRegion may be sent. A field that's omitted keeps its current
// value; explicit null clears preferredFormat/preferredRegion (cardSize has
// no "unset" state — it always has a default). Reads the existing row first
// so updating one field never clobbers another already-set one.
settingsRouter.put('/', (req, res) => {
  const uid = requireUid(req, res);
  if (!uid) return;

  const { cardSize, preferredFormat, preferredRegion } = req.body;

  if (cardSize !== undefined && !isValidCardSize(cardSize)) {
    res.status(400).json({ error: `cardSize must be one of ${VALID_CARD_SIZES.join(', ')}` });
    return;
  }
  if (preferredFormat !== undefined && preferredFormat !== null && !isValidPreferredFormat(preferredFormat)) {
    res.status(400).json({ error: `preferredFormat must be one of ${VALID_PREFERRED_FORMATS.join(', ')}, or null` });
    return;
  }
  if (preferredRegion !== undefined && preferredRegion !== null && !isValidPreferredRegion(preferredRegion)) {
    res.status(400).json({ error: 'preferredRegion must be a 2-letter region code, or null' });
    return;
  }

  const current = rowToPayload(readSettingsRow(uid));
  const next: UserSettingsPayload = {
    cardSize: cardSize !== undefined ? cardSize : current.cardSize,
    preferredFormat: preferredFormat !== undefined ? preferredFormat : current.preferredFormat,
    preferredRegion: preferredRegion !== undefined ? preferredRegion : current.preferredRegion,
  };

  db.prepare(
    `INSERT INTO user_settings (user_id, card_size, preferred_format, preferred_region) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       card_size = excluded.card_size,
       preferred_format = excluded.preferred_format,
       preferred_region = excluded.preferred_region`,
  ).run(uid, next.cardSize, next.preferredFormat, next.preferredRegion);

  res.json(next);
});
