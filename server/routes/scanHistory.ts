import { randomUUID } from 'crypto';
import { Router } from 'express';
import { db, pruneScanHistory } from '../db.js';
import { logEvent, logWarn, newRequestId } from '../logger.js';
import type { BlobStorageProvider } from '../storage/BlobStorageProvider.js';

const DEFAULT_SCAN_HISTORY_LIMIT = 50;

// Stored as opaque JSON blobs — the client (types.ts) owns the real shapes
// of ScanVisionSuggestion / SearchIntent / SearchResultGroup / VinylRecord.
// The server never inspects their fields, only persists and replays them.
type ScanVisionSuggestion = Record<string, unknown>;
type SearchIntent = Record<string, unknown>;
type SearchResultGroup = Record<string, unknown>;
type VinylRecord = Record<string, unknown>;

interface ScanHistoryRow {
  id: string;
  created_at: number;
  image_url: string | null;
  vision_guesses: string | null;
  suggested_query: string | null;
  initial_suggestions: string | null;
  searches: string;
}

interface ScanHistorySearchEntry {
  intent: SearchIntent;
  resultGroups: SearchResultGroup[];
  searchedAt: number;
}

interface ScanHistoryEntry {
  id: string;
  createdAt: number;
  imageUrl: string | null;
  visionGuesses: ScanVisionSuggestion[];
  suggestedQuery?: string;
  initialSuggestions: VinylRecord[];
  searches: ScanHistorySearchEntry[];
}

function rowToEntry(row: ScanHistoryRow): ScanHistoryEntry {
  return {
    id: row.id,
    createdAt: row.created_at,
    imageUrl: row.image_url,
    visionGuesses: row.vision_guesses ? JSON.parse(row.vision_guesses) : [],
    suggestedQuery: row.suggested_query ?? undefined,
    initialSuggestions: row.initial_suggestions ? JSON.parse(row.initial_suggestions) : [],
    searches: JSON.parse(row.searches),
  };
}

function getRow(id: string, userId: string): ScanHistoryRow | undefined {
  return db
    .prepare('SELECT * FROM scan_history WHERE id = ? AND user_id = ?')
    .get(id, userId) as ScanHistoryRow | undefined;
}

/**
 * Creates the scan-history router.
 *
 * Persists the raw AI-assisted scan result (captured photo + vision guesses
 * + every search run against them) so a user can revisit it later without
 * spending more vision-API budget re-identifying the same sleeve.
 */
export function createScanHistoryRouter(storage: BlobStorageProvider, limit = DEFAULT_SCAN_HISTORY_LIMIT): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const requestId = newRequestId();
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const { capturedImage, visionGuesses, suggestedQuery, initialSuggestions } = req.body as {
      capturedImage?: string;
      visionGuesses?: ScanVisionSuggestion[];
      suggestedQuery?: string;
      initialSuggestions?: VinylRecord[];
    };

    if (!capturedImage || typeof capturedImage !== 'string') {
      res.status(400).json({ error: 'capturedImage is required' });
      return;
    }

    const id = randomUUID();
    const createdAt = Date.now();

    let imageUrl: string | null = null;
    try {
      const imageBuffer = Buffer.from(capturedImage, 'base64');
      imageUrl = await storage.put(`scan-history/${id}.jpg`, imageBuffer, 'image/jpeg');
    } catch (err) {
      logWarn('scan-history', requestId, 'Could not store captured image, continuing without it', { error: String(err) });
    }

    db.prepare(
      `INSERT INTO scan_history (id, created_at, image_url, vision_guesses, suggested_query, initial_suggestions, searches, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      createdAt,
      imageUrl,
      visionGuesses ? JSON.stringify(visionGuesses) : null,
      suggestedQuery ?? null,
      initialSuggestions ? JSON.stringify(initialSuggestions) : null,
      '[]',
      uid,
    );

    const prunedIds = pruneScanHistory(limit, uid);
    for (const prunedId of prunedIds) {
      try {
        await storage.delete(`scan-history/${prunedId}.jpg`);
      } catch (err) {
        logWarn('scan-history', requestId, 'Could not delete pruned scan image', { prunedId, error: String(err) });
      }
    }

    logEvent('scan-history', requestId, 'Saved scan history entry', { id, prunedCount: prunedIds.length });

    const row = getRow(id, uid)!;
    res.status(201).json(rowToEntry(row));
  });

  router.get('/', (req, res) => {
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const rows = db
      .prepare('SELECT * FROM scan_history WHERE user_id = ? ORDER BY created_at DESC, rowid DESC')
      .all(uid) as ScanHistoryRow[];
    res.json({ entries: rows.map(rowToEntry) });
  });

  router.get('/:id', (req, res) => {
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const row = getRow(req.params.id, uid);
    if (!row) {
      res.status(404).json({ error: 'Scan history entry not found' });
      return;
    }
    res.json(rowToEntry(row));
  });

  router.post('/:id/searches', (req, res) => {
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const row = getRow(req.params.id, uid);
    if (!row) {
      res.status(404).json({ error: 'Scan history entry not found' });
      return;
    }

    const { intent, resultGroups } = req.body as { intent?: SearchIntent; resultGroups?: SearchResultGroup[] };
    if (!intent || !Array.isArray(resultGroups)) {
      res.status(400).json({ error: 'intent and resultGroups are required' });
      return;
    }

    const searches: ScanHistorySearchEntry[] = JSON.parse(row.searches);
    searches.push({ intent, resultGroups, searchedAt: Date.now() });

    db.prepare('UPDATE scan_history SET searches = ? WHERE id = ?').run(JSON.stringify(searches), row.id);

    res.json(rowToEntry(getRow(row.id, uid)!));
  });

  router.delete('/:id', async (req, res) => {
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const row = getRow(req.params.id, uid);
    if (!row) {
      res.status(404).json({ error: 'Scan history entry not found' });
      return;
    }

    db.prepare('DELETE FROM scan_history WHERE id = ?').run(row.id);

    if (row.image_url) {
      try {
        await storage.delete(`scan-history/${row.id}.jpg`);
      } catch (err) {
        logWarn('scan-history', newRequestId(), 'Could not delete scan history image', { id: row.id, error: String(err) });
      }
    }

    res.json({ success: true });
  });

  return router;
}
