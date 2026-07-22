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