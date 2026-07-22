import { SearchResultGroup } from '../types';

// bucketForFormat groups MusicBrainz's raw format strings into coarser
// buckets, used to organise an already-expanded group's release list into
// Vinyl/CD/etc. sections (see groupReleasesByFormatBucket). There is no
// top-level Format filter anymore — release-groups no longer carry format
// data at search time (see musicbrainz-data-model.md), only the Type filter
// does since primaryType comes free with every search result.
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

// A release-group's type is a direct passthrough of MusicBrainz's own
// primary-type (Album/Single/EP/...), unlike format there's no stringly
// variant to merge (e.g. no "12" Vinyl" vs "Vinyl" equivalent for type).
export function typeBucketForGroup(group: SearchResultGroup): string {
  return group.primaryType ?? 'Unknown';
}

// Shared ordering: priority items first (in the order given), then
// everything else alphabetically, Unknown last. Used for the type dropdown,
// and for grouping releases inside an expanded group's "Show releases"
// accordion, so both stay visually consistent.
export function sortBucketsWithPriority(buckets: string[], priority: string[]): string[] {
  const priorityPresent = priority.filter((bucket) => buckets.includes(bucket));
  const rest = buckets
    .filter((bucket) => bucket !== 'Unknown' && !priority.includes(bucket))
    .sort((a, b) => a.localeCompare(b));
  const unknown = buckets.includes('Unknown') ? ['Unknown'] : [];
  return [...priorityPresent, ...rest, ...unknown];
}

export function sortTypeBuckets(buckets: string[]): string[] {
  return sortBucketsWithPriority(buckets, PRIORITY_TYPE_BUCKETS);
}

export function sortFormatBuckets(buckets: string[]): string[] {
  return sortBucketsWithPriority(buckets, PRIORITY_FORMAT_BUCKETS);
}

// Groups a flat release list into format buckets, Vinyl/CD prioritised, while
// preserving each release's exact original format string (e.g. "2xCD",
// "CD-R") — grouping is purely a display concern, not a data-collapsing one.
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

export type FormatFamily = 'Vinyl' | 'CD' | 'Cassette' | 'Digital Media' | 'DVD/Blu-ray' | 'Other';

// The fixed set a "preferred format" setting can choose from — deliberately
// not the same list as bucketForFormat's dynamically-discovered buckets
// above, since a settings dropdown needs a small closed list, not "whatever
// raw strings happened to show up in the last search". Same substring
// patterns ReleaseGroupResultsList's getFormatIcon already used for icon
// selection, so icon lookup and preference matching share one definition of
// "which family is this".
export const FORMAT_FAMILY_OPTIONS: FormatFamily[] = ['Vinyl', 'CD', 'Cassette', 'Digital Media', 'DVD/Blu-ray'];

export function classifyFormatFamily(rawFormat?: string): FormatFamily {
  if (!rawFormat) return 'Other';
  const normalized = rawFormat.toLowerCase();
  if (normalized.includes('vinyl') || normalized === 'lp') return 'Vinyl';
  if (normalized.includes('cd')) return 'CD';
  if (normalized.includes('cassette') || normalized.includes('tape')) return 'Cassette';
  if (normalized.includes('digital')) return 'Digital Media';
  if (normalized.includes('dvd') || normalized.includes('blu-ray') || normalized.includes('video')) return 'DVD/Blu-ray';
  return 'Other';
}

export interface RepresentativePreferences {
  preferredFormat?: string | null;
  preferredRegion?: string | null;
}

function defaultRepresentative<T extends { country?: string; releaseDate?: string }>(releases: T[]): T {
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

// Picks one release to add/show by default when the user hasn't manually
// chosen a specific edition. preferredFormat is applied first (format
// matters more to most collectors than region) — if nothing in this group
// matches, the format preference is dropped and every release stays in
// play. preferredRegion is then a secondary preference within whatever the
// format step left: an exact country match wins outright; otherwise falls
// back to the original Worldwide > earliest releaseDate > first-in-list
// priority. Passing no preferences (or preferences the caller doesn't set)
// reproduces the original behavior exactly.
export function pickRepresentativeRelease<
  T extends { country?: string; releaseDate?: string; format?: string },
>(releases: T[], preferences?: RepresentativePreferences): T {
  const formatCandidates = preferences?.preferredFormat
    ? (() => {
        const matches = releases.filter(
          (release) => classifyFormatFamily(release.format) === preferences.preferredFormat,
        );
        return matches.length > 0 ? matches : releases;
      })()
    : releases;

  if (preferences?.preferredRegion) {
    const regionMatch = formatCandidates.find((release) => release.country === preferences.preferredRegion);
    if (regionMatch) return regionMatch;
  }

  return defaultRepresentative(formatCandidates);
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
>(releases: T[], preferences?: RepresentativePreferences): ReleaseVariantGroup<T>[] {
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
    return { ...entry, representative: pickRepresentativeRelease(entry.releases, preferences) };
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
