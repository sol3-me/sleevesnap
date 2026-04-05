import { ScanResponse, ScanUploadPayload, VinylRecord } from '../types';

/**
 * Sends a base64-encoded JPEG to the server-side scan endpoint, which
 * checks the image against the user's collection using a local perceptual
 * hashing algorithm (dHash).
 *
 * Returns `{ matched: true, record }` when a collection item matches, or
 * `{ matched: false }` when no match is found and the user should be asked
 * to search manually.
 */
export const scanImage = async (base64Image: string): Promise<ScanResponse> => {
  const res = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Image }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Failed to scan image.');
  }

  return res.json();
};

/**
 * Uploads a confirmed scan result to the server.  The server adds the record
 * to the collection and stores the perceptual hash for future matching.
 */
export const submitScan = async (payload: ScanUploadPayload): Promise<VinylRecord> => {
  const res = await fetch('/api/scans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Failed to save scan.');
  }

  const data = await res.json() as { record: VinylRecord };
  return data.record;
};

/**
 * Queries the server-side search endpoint, which uses MusicBrainz to find
 * vinyl records matching the given query string.
 */
export const searchVinylDatabase = async (query: string): Promise<VinylRecord[]> => {
  const res = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) return [];
  return res.json();
};

// ---------------------------------------------------------------------------
// Legacy export kept for backwards compatibility
// ---------------------------------------------------------------------------

/** @deprecated Use scanImage() instead */
export const identifyVinylsFromImage = async (base64Image: string) => {
  const result = await scanImage(base64Image);
  if (result.matched) {
    return [{ artist: result.record.artist, title: result.record.title, year: result.record.year, genre: result.record.genre, confidence: 1.0 }];
  }
  return [];
};

