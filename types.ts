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

// Release-group-only: title/artist/type/date/cover-art. Formats, release
// count, and discogs-master-url don't exist here anymore — they only become
// known once a group is deliberately expanded, see SearchGroupReleases.
export interface SearchResultGroup {
  releaseGroupId: string;
  title: string;
  artist: string;
  firstReleaseDate?: string;
  secondaryTypes?: string[];
  releaseGroupUrl: string;
  thumbnailUrl?: string;
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

export interface SearchIntent {
  artist?: string;
  title?: string;
  year?: string;
  label?: string;
  artistId?: string;
  labelId?: string;
  format?: string;
  country?: string;
  primaryTypes?: string[];
  excludePrimaryTypes?: string[];
  discographyBrowse?: boolean;
}

export interface ArtistSearchEntity {
  id: string;
  name: string;
  disambiguation?: string;
  country?: string;
  area?: string;
  beginArea?: string;
  sortName?: string;
  type?: string;
  lifeSpanBegin?: string;
  lifeSpanEnd?: string;
  lifeSpanEnded?: boolean;
  score?: number;
}

export interface LabelSearchEntity {
  id: string;
  name: string;
  disambiguation?: string;
  country?: string;
  area?: string;
  sortName?: string;
  type?: string;
  labelCode?: string;
  score?: number;
}

export interface SearchEntityPage<T> {
  query: string;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  entities: T[];
}

export type SearchMode = 'simple' | 'indexed';

export interface SearchGroupReleases {
  releaseGroupId: string;
  availableFormats: string[];
  discogsMasterUrl?: string;
  releases: SearchRelease[];
}

export interface ScanResult {
  artist: string;
  title: string;
  year?: string;
  genre?: string;
  confidence: number;
}

export interface ScanVisionSuggestion {
  artist: string;
  title: string;
  year?: string;
  genre?: string;
  confidence: number;
  /** True when a background MusicBrainz release-group search found at least one match for this guess. */
  validated?: boolean;
  /** The release groups that background search found (empty when not validated). */
  matchedGroups?: SearchResultGroup[];
}

/** Response from GET /api/scan/quota — the user's remaining daily AI-scan allowance. */
export interface ScanQuota {
  used: number;
  limit: number;
  remaining: number;
}

export interface ScanVisionMetadata {
  guesses: ScanVisionSuggestion[];
  suggestedQuery?: string;
}

/** Response from POST /api/scan */
export type ScanResponse =
  | { matched: true; record: VinylRecord }
  | { matched: false; vision?: ScanVisionMetadata; notAlbumCover?: boolean };

export interface ScanHistorySearchEntry {
  intent: SearchIntent;
  resultGroups: SearchResultGroup[];
  searchedAt: number;
}

/** A persisted AI-assisted scan: captured photo + raw vision guesses + every search run against them. */
export interface ScanHistoryEntry {
  id: string;
  createdAt: number;
  imageUrl: string | null;
  visionGuesses: ScanVisionSuggestion[];
  suggestedQuery?: string;
  initialSuggestions: VinylRecord[];
  searches: ScanHistorySearchEntry[];
}

/** Payload for POST /api/scan-history (persisting a fresh AI-assisted scan) */
export interface ScanHistoryCreatePayload {
  capturedImage: string;
  visionGuesses?: ScanVisionSuggestion[];
  suggestedQuery?: string;
  initialSuggestions?: VinylRecord[];
}

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
