import { ScanResult, VinylRecord } from '../types';

/**
 * Sends a base64-encoded JPEG to the server-side scan endpoint, which
 * uses a local vision model (Ollama) to identify vinyl records in the image.
 */
export const identifyVinylsFromImage = async (base64Image: string): Promise<ScanResult[]> => {
  const res = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Image }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Failed to identify vinyls.');
  }

  return res.json();
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
