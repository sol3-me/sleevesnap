// Muted sleeve-ish tones for tiles the cover cache can't fill yet, so a
// cold cache still reads as a wall of records rather than a broken grid.
export const WALL_PALETTE = [
  '#4a1b0c',
  '#26215c',
  '#04342c',
  '#412402',
  '#4b1528',
  '#042c53',
  '#2c2c2a',
  '#501313',
  '#173404',
  '#712b13',
  '#3c3489',
  '#085041',
];

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
