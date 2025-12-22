export interface VinylRecord {
  id: string;
  artist: string;
  title: string;
  year?: string;
  genre?: string;
  coverUrl?: string; // URL or Base64
  dateAdded: number;
  notes?: string;
}

export enum ViewState {
  DASHBOARD = 'DASHBOARD',
  SCANNER = 'SCANNER',
  SEARCH = 'SEARCH',
  SETTINGS = 'SETTINGS',
  LOGIN = 'LOGIN'
}

export interface UserProfile {
  name: string;
  email: string;
  avatarUrl: string;
}

export interface ScanResult {
  artist: string;
  title: string;
  year?: string;
  genre?: string;
  confidence: number;
}
