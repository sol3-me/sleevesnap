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
