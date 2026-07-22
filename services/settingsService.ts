import { apiFetch } from '../lib/apiFetch';

export type CardSize = 'S' | 'M' | 'L';

export interface UserSettings {
  cardSize: CardSize;
  preferredFormat: string | null;
  preferredRegion: string | null;
}

export type UserSettingsUpdate = Partial<UserSettings>;

const DEFAULT_SETTINGS: UserSettings = { cardSize: 'M', preferredFormat: null, preferredRegion: null };

export const getSettings = async (): Promise<UserSettings> => {
  const res = await apiFetch('/api/settings');
  if (!res.ok) return DEFAULT_SETTINGS;
  return res.json();
};

export const updateSettings = async (update: UserSettingsUpdate): Promise<UserSettings> => {
  const res = await apiFetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  if (!res.ok) throw new Error('Failed to update settings');
  return res.json();
};
