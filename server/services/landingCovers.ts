import type { LandingPoolEntry } from './landingPool.js';

export type LandingCover = { url: string; artist: string; album: string };

export function coverCacheKey(_artist: string, _album: string): string {
  return '';
}

export function pickRandomCovers<T>(
  _items: readonly T[],
  _count: number,
  _random: () => number = Math.random,
): T[] {
  return [];
}

export function getCachedLandingCovers(
  _count: number,
  _random: () => number = Math.random,
): LandingCover[] {
  return [];
}

export async function warmLandingCovers(
  _pool: readonly LandingPoolEntry[],
  _fetchCover: (artist: string, album: string) => Promise<string | null>,
  _delayMs: number,
): Promise<void> {}
