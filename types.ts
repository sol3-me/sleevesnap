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

/** Response from POST /api/scan */
export type ScanResponse =
  | { matched: true; record: VinylRecord }
  | { matched: false };

/** Payload for POST /api/scans (confirmed scan upload) */
export interface ScanUploadPayload {
  artist: string;
  title: string;
  year?: string;
  genre?: string;
  notes?: string;
  /** Base64-encoded photo taken by the scanner (optional) */
  capturedImage?: string;
  /** Cover art URL from a search result (optional) */
  coverUrl?: string;
}
