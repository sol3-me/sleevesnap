export interface VinylRecord {
  id: string;
  artist: string;
  title: string;
  year?: string;
  releaseDate?: string;
  genre?: string;
  format?: string;
  country?: string;
  releaseStatus?: string;
  edition?: string;
  musicBrainzId?: string;
  releaseGroupId?: string;
  releaseGroupTitle?: string;
  releaseGroupUrl?: string;
  releaseUrl?: string;
  discogsUrl?: string;
  thumbnailUrl?: string;
  coverUrl?: string; // URL or Base64
  dateAdded: number;
  notes?: string;
}

export interface SearchRelease extends VinylRecord {
  releaseGroupId?: string;
  releaseGroupTitle?: string;
  releaseGroupUrl?: string;
  releaseUrl?: string;
}

export interface SearchResultGroup {
  releaseGroupId: string;
  title: string;
  artist: string;
  firstReleaseDate?: string;
  releaseGroupUrl: string;
  thumbnailUrl?: string;
  availableFormats: string[];
  discogsMasterUrl?: string;
  totalReleases: number;
  /** MusicBrainz's Album/Single/EP/etc. classification — same title, different real release. */
  primaryType?: string;
}

export interface SearchResultPage {
  query: string;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  isTotalExact: boolean;
  groups: SearchResultGroup[];
}

export interface SearchGroupReleases {
  releaseGroupId: string;
  availableFormats: string[];
  discogsMasterUrl?: string;
  releases: SearchRelease[];
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
  | { matched: false; suggestions?: VinylRecord[] };

/** Payload for POST /api/scans (confirmed scan upload) */
export interface ScanUploadPayload {
  artist: string;
  title: string;
  year?: string;
  releaseDate?: string;
  genre?: string;
  format?: string;
  country?: string;
  releaseStatus?: string;
  edition?: string;
  musicBrainzId?: string;
  releaseGroupId?: string;
  releaseGroupTitle?: string;
  releaseGroupUrl?: string;
  releaseUrl?: string;
  discogsUrl?: string;
  thumbnailUrl?: string;
  notes?: string;
  /** Base64-encoded photo taken by the scanner (optional) */
  capturedImage?: string;
  /** Cover art URL from a search result (optional) */
  coverUrl?: string;
}
