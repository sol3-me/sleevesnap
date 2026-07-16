/**
 * Deterministic RNG (mulberry32) so a per-session seed produces the same
 * wall selection on every reload — letting the service worker serve the
 * repeated cover requests from cache instead of hitting the network.
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Wall tile counts by viewport width, matching the hero grid's Tailwind
 * breakpoints (grid-cols-4 / sm:6 / lg:8 at 5 rows): mobile draws fewer
 * covers than desktop.
 */
export function wallTileCountFor(width: number): number {
  if (width < 640) return 20;
  if (width < 1024) return 30;
  return 40;
}

/**
 * Client-side wall selection: draws `count` distinct covers by pushing
 * RNG-picked indices into a hash set until it has enough (returns all
 * covers when the pool is smaller than `count`).
 */
export function pickWallCovers(
  covers: readonly LandingCover[],
  count: number,
  random: () => number = Math.random,
): LandingCover[] {
  const target = Math.min(Math.max(count, 0), covers.length);
  const indices = new Set<number>();
  while (indices.size < target) {
    indices.add(Math.floor(random() * covers.length));
  }
  return [...indices].map((i) => covers[i]);
}

export type WallTile =
  | { kind: 'cover'; url: string; artist: string; album: string }
  | { kind: 'placeholder'; color: string };

export type LandingCover = { url: string; artist: string; album: string };

/**
 * Lays out the landing hero's cover wall: real covers first (server already
 * randomised them), then flat-colour placeholder tiles cycling `palette` so
 * the grid is always full — even on a cold cache with zero covers.
 */
export function buildWallTiles(
  covers: readonly LandingCover[],
  total: number,
  palette: readonly string[],
): WallTile[] {
  const tiles: WallTile[] = covers
    .slice(0, total)
    .map(({ url, artist, album }) => ({ kind: 'cover' as const, url, artist, album }));

  const colors = palette.length > 0 ? palette : ['transparent'];
  for (let i = 0; tiles.length < total; i++) {
    tiles.push({ kind: 'placeholder', color: colors[i % colors.length] });
  }

  return tiles;
}
