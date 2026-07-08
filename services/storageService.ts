import { VinylRecord } from '../types';

// ---------------------------------------------------------------------------
// Collection – persisted server-side via REST API
// ---------------------------------------------------------------------------

export const getCollection = async (): Promise<VinylRecord[]> => {
  const res = await fetch('/api/collection');
  if (!res.ok) return [];
  return res.json();
};

export const addRecord = async (record: VinylRecord): Promise<boolean> => {
  const res = await fetch('/api/collection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  if (res.status === 409) return false; // duplicate
  return res.ok;
};

export const removeRecord = async (id: string): Promise<void> => {
  await fetch(`/api/collection/${encodeURIComponent(id)}`, { method: 'DELETE' });
};