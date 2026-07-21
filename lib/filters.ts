import { SearchResultGroup } from '../types';

// Both filters below are client-side (see musicbrainz-data-model.md): the
// server returns every release-group unfiltered, enriched with its real
// formats/type, and these "buckets" group MusicBrainz's raw values into
// dropdown options. Neither dropdown's option list is hardcoded — both are
// discovered dynamically from real results (see discoveredFormatBuckets /
// discoveredTypeBuckets in DiscoverView), so an unfamiliar MusicBrainz value
// (a new format string, or a primary type like "Broadcast") still gets its
// own option rather than being silently dropped.
export const PRIORITY_FORMAT_BUCKETS = ['Vinyl', 'CD'];
const KNOWN_FORMAT_BUCKETS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'Vinyl', pattern: /vinyl|\blp\b/i },
  { name: 'CD', pattern: /\bcd\b/i },
];
// Just an ordering preference for the 3 most common release-group types —
// not an exhaustive option list. Anything else (Broadcast, Other, ...)
// still renders as its own dynamically-discovered option.
export const PRIORITY_TYPE_BUCKETS = ['Album', 'Single', 'EP'];

export function bucketForFormat(rawFormat: string): string {
  const known = KNOWN_FORMAT_BUCKETS.find((bucket) => bucket.pattern.test(rawFormat));
  return known ? known.name : rawFormat;
}

export function formatBucketsForGroup(group: SearchResultGroup): string[] {
  return Array.from(new Set(group.availableFormats.map(bucketForFormat)));
}

// A release-group's type is a direct passthrough of MusicBrainz's own
// primary-type (Album/Single/EP/...), unlike format there's no stringly
// variant to merge (e.g. no "12" Vinyl" vs "Vinyl" equivalent for type).
export function typeBucketForGroup(group: SearchResultGroup): string {
  return group.primaryType ?? 'Unknown';
}

// Shared ordering: priority items first (in the order given), then
// everything else alphabetically, Unknown last. Used for both the format and
// type dropdowns, and for grouping releases inside an expanded group's "Show
// releases" accordion, so all three stay visually consistent.
export function sortBucketsWithPriority(buckets: string[], priority: string[]): string[] {
  const priorityPresent = priority.filter((bucket) => buckets.includes(bucket));
  const rest = buckets
    .filter((bucket) => bucket !== 'Unknown' && !priority.includes(bucket))
    .sort((a, b) => a.localeCompare(b));
  const unknown = buckets.includes('Unknown') ? ['Unknown'] : [];
  return [...priorityPresent, ...rest, ...unknown];
}

export function sortFormatBuckets(buckets: string[]): string[] {
  return sortBucketsWithPriority(buckets, PRIORITY_FORMAT_BUCKETS);
}

export function sortTypeBuckets(buckets: string[]): string[] {
  return sortBucketsWithPriority(buckets, PRIORITY_TYPE_BUCKETS);
}

// Groups a flat release list into format buckets (same grouping as the
// top-level filter), sorted the same way, while preserving each release's
// exact original format string (e.g. "2xCD", "CD-R") — grouping is purely a
// display concern, not a data-collapsing one.
export function groupReleasesByFormatBucket<T extends { format?: string }>(
  releases: T[],
): Array<{ bucket: string; releases: T[] }> {
  const byBucket = new Map<string, T[]>();
  for (const release of releases) {
    const bucket = bucketForFormat(release.format ?? 'Unknown');
    const existing = byBucket.get(bucket);
    if (existing) {
      existing.push(release);
    } else {
      byBucket.set(bucket, [release]);
    }
  }

  return sortFormatBuckets(Array.from(byBucket.keys())).map((bucket) => ({
    bucket,
    releases: byBucket.get(bucket)!,
  }));
}

export interface ReleaseVariantGroup<T> {
  format: string;
  year: string;
  releases: T[];
  /** The pressing shown by default and used for the one-click action — see pickRepresentativeRelease. */
  representative: T;
}

// "XW" (Worldwide) is MusicBrainz's own code for a release not tied to any
// single country — the closest thing to a canonical, region-agnostic
// pressing, so it's the best default when one exists.
const WORLDWIDE_COUNTRY_CODE = 'XW';

function pickRepresentativeRelease<T extends { country?: string; releaseDate?: string }>(releases: T[]): T {
  const worldwide = releases.find((release) => release.country === WORLDWIDE_COUNTRY_CODE);
  if (worldwide) return worldwide;

  const dated = releases.filter((release) => release.releaseDate);
  if (dated.length > 0) {
    return dated.reduce((earliest, release) =>
      release.releaseDate! < earliest.releaseDate! ? release : earliest,
    );
  }

  return releases[0];
}

// Same album/format/year pressed in a dozen countries reads as spam in an
// expanded release list — group them into one variant so the default view
// shows one entry per real edition, with the full region list available to
// power users who want a specific pressing. Deliberately keyed on the exact
// format string (not the coarser Vinyl/CD bucket above): a 12" and a 7"
// pressed the same year are different physical products, not variants of
// each other.
export function groupReleasesByFormatAndYear<
  T extends { format?: string; year?: string; country?: string; releaseDate?: string },
>(releases: T[]): ReleaseVariantGroup<T>[] {
  const order: string[] = [];
  const byKey = new Map<string, { format: string; year: string; releases: T[] }>();

  for (const release of releases) {
    const format = release.format ?? 'Unknown';
    const year = release.year ?? 'Unknown';
    const key = `${format}::${year}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.releases.push(release);
    } else {
      byKey.set(key, { format, year, releases: [release] });
      order.push(key);
    }
  }

  return order.map((key) => {
    const entry = byKey.get(key)!;
    return { ...entry, representative: pickRepresentativeRelease(entry.releases) };
  });
}

// Sparse: only buckets the user has explicitly toggled are stored. Anything
// absent (including a bucket never seen before) defaults to checked/visible
// — the goal is to extract as much signal from MusicBrainz as possible
// rather than let a gap in its data quietly hide a real result.
export type FilterState = Record<string, boolean>;

export function loadStoredFilterState(key: string): FilterState {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: FilterState = {};
    for (const [bucket, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') result[bucket] = value;
    }
    return result;
  } catch {
    return {};
  }
}
