// A BCP-47 locale tag is language[-Script][-REGION][-variant...], e.g.
// "en-GB" or "zh-Hans-CN". The region subtag (when present) is always
// exactly 2 alpha characters — script subtags are 4 letters (Hans),
// language subtags are 2-3. Skip the first (language) subtag and take the
// first remaining one that matches that shape.
export function detectRegionFromLocale(locale: string | undefined): string | undefined {
  if (!locale) return undefined;
  const parts = locale.split('-');
  for (let i = 1; i < parts.length; i++) {
    if (/^[A-Za-z]{2}$/.test(parts[i])) {
      return parts[i].toUpperCase();
    }
  }
  return undefined;
}

/** First locale in priority order (as navigator.languages already is) with a resolvable region. */
export function detectRegionFromLocales(locales: readonly string[] | undefined): string | undefined {
  for (const locale of locales ?? []) {
    const region = detectRegionFromLocale(locale);
    if (region) return region;
  }
  return undefined;
}

// Arbitrary but deliberate: when nothing else resolves a region (no
// preference set, no browser locale carries one), UK is the fallback.
export const FALLBACK_REGION = 'GB';

/**
 * The region actually used to pick a representative pressing when the user
 * hasn't set an explicit preferredRegion: their browser's locale (mirrors
 * what the browser would send as Accept-Language — no server round-trip or
 * IP geolocation involved), falling back to FALLBACK_REGION if that carries
 * no region either. An explicit preference always wins.
 */
export function resolveEffectivePreferredRegion(
  explicitPreferredRegion: string | null | undefined,
  browserLocales: readonly string[] | undefined,
): string {
  if (explicitPreferredRegion) return explicitPreferredRegion;
  return detectRegionFromLocales(browserLocales) ?? FALLBACK_REGION;
}

// DOM-touching, so deliberately left untested (mirrors lib/downloadFile.ts's
// precedent for browser-only helpers) — the pure logic above is what's
// covered by tests.
export function getBrowserLocales(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages ?? (navigator.language ? [navigator.language] : []);
}
