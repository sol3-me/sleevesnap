import { apiFetch } from '../lib/apiFetch';
import { VinylRecord } from '../types';

// ---------------------------------------------------------------------------
// Collection – persisted server-side via REST API
// ---------------------------------------------------------------------------

export const getCollection = async (): Promise<VinylRecord[]> => {
  const res = await apiFetch('/api/collection');
  if (!res.ok) return [];
  return res.json();
};

export const addRecord = async (record: VinylRecord): Promise<boolean> => {
  const res = await apiFetch('/api/collection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  if (res.status === 409) return false; // duplicate
  return res.ok;
};

export const removeRecord = async (id: string): Promise<void> => {
  await apiFetch(`/api/collection/${encodeURIComponent(id)}`, { method: 'DELETE' });
};

export const clearCollection = async (): Promise<void> => {
  await apiFetch('/api/collection', { method: 'DELETE' });
};

export interface ImportCollectionResult {
  added: number;
  duplicates: number;
}

export const importCollection = async (records: VinylRecord[]): Promise<ImportCollectionResult> => {
  const res = await apiFetch('/api/collection/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  });
  if (!res.ok) throw new Error('Failed to import collection');
  return res.json();
};

/** Uploads a custom cover photo (bare base64, no data-URL prefix) for an existing record. */
export const setRecordCoverPhoto = async (id: string, base64Photo: string): Promise<VinylRecord> => {
  const res = await apiFetch(`/api/collection/${encodeURIComponent(id)}/cover`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo: base64Photo }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Failed to set cover photo.');
  }
  const data = await res.json() as { record: VinylRecord };
  return data.record;
};

/** Reverts to the MusicBrainz-sourced cover — the previously uploaded photo stays in storage so this can be toggled back. */
export const revertRecordCoverToMusicBrainz = async (id: string): Promise<VinylRecord> => {
  const res = await apiFetch(`/api/collection/${encodeURIComponent(id)}/cover`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'musicbrainz' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Failed to revert cover.');
  }
  const data = await res.json() as { record: VinylRecord };
  return data.record;
};