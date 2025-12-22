import { VinylRecord, UserProfile } from '../types';

const STORAGE_KEY_COLLECTION = 'sleevesnap_collection';
const STORAGE_KEY_USER = 'sleevesnap_user';

export const getCollection = (): VinylRecord[] => {
  const data = localStorage.getItem(STORAGE_KEY_COLLECTION);
  return data ? JSON.parse(data) : [];
};

export const saveCollection = (collection: VinylRecord[]) => {
  localStorage.setItem(STORAGE_KEY_COLLECTION, JSON.stringify(collection));
};

export const addRecord = (record: VinylRecord) => {
  const collection = getCollection();
  // Avoid duplicates based on basic heuristics
  const exists = collection.some(r => 
    r.title.toLowerCase() === record.title.toLowerCase() && 
    r.artist.toLowerCase() === record.artist.toLowerCase()
  );
  
  if (!exists) {
    collection.unshift(record);
    saveCollection(collection);
  }
  return !exists;
};

export const removeRecord = (id: string) => {
  const collection = getCollection();
  const updated = collection.filter(r => r.id !== id);
  saveCollection(updated);
};

export const getUser = (): UserProfile | null => {
  const data = localStorage.getItem(STORAGE_KEY_USER);
  return data ? JSON.parse(data) : null;
};

export const loginUser = (name: string): UserProfile => {
  // Simulating OAuth/Auth process
  const user: UserProfile = {
    name,
    email: `${name.toLowerCase().replace(/\s/g, '.')}@sleevesnap.app`,
    avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=ff6b6b&color=fff`
  };
  localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
  return user;
};

export const logoutUser = () => {
  localStorage.removeItem(STORAGE_KEY_USER);
};