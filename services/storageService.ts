import { VinylRecord, UserProfile } from '../types';

const STORAGE_KEY_USER = 'sleevesnap_user';

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

// ---------------------------------------------------------------------------
// User profile – kept in localStorage (no server-side auth required)
// ---------------------------------------------------------------------------

export const getUser = (): UserProfile | null => {
  const data = localStorage.getItem(STORAGE_KEY_USER);
  return data ? JSON.parse(data) : null;
};

export const loginUser = (name: string): UserProfile => {
  const user: UserProfile = {
    name,
    email: `${name.toLowerCase().replace(/\s/g, '.')}@sleevesnap.app`,
    avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=ff6b6b&color=fff`,
  };
  localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
  return user;
};

export const logoutUser = (): void => {
  localStorage.removeItem(STORAGE_KEY_USER);
};