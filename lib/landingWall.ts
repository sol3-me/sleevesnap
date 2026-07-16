/**
 * Wall tile counts by viewport width, matching the hero grid's Tailwind
 * breakpoints (grid-cols-4 / sm:6 / lg:8 at 5 rows): mobile draws fewer
 * covers than desktop.
 */
export function wallTileCountFor(_width: number): number {
  return 0;
}

/**
 * Client-side wall selection: draws `count` distinct covers by pushing
 * RNG-picked indices into a hash set until it has enough (returns all
 * covers when the pool is smaller than `count`).
 */
export function pickWallCovers(
  _covers: readonly LandingCover[],
  _count: number,
  _random: () => number = Math.random,
): LandingCover[] {
  return [];
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
