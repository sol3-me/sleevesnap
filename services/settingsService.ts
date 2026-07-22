import { apiFetch } from '../lib/apiFetch';

export type CardSize = 'S' | 'M' | 'L';

export interface UserSettings {
  cardSize: CardSize;
}

const DEFAULT_SETTINGS: UserSettings = { cardSize: 'M' };

export const getSettings = async (): Promise<UserSettings> => {
  const res = await apiFetch('/api/settings');
  if (!res.ok) return DEFAULT_SETTINGS;
  return res.json();
};

export const updateCardSize = async (cardSize: CardSize): Promise<UserSettings> => {
  const res = await apiFetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardSize }),
  });
  if (!res.ok) throw new Error('Failed to update settings');
  return res.json();
};
