export type WallTile =
  | { kind: 'cover'; url: string; artist: string; album: string }
  | { kind: 'placeholder'; color: string };

export type LandingCover = { url: string; artist: string; album: string };

export function buildWallTiles(
  _covers: readonly LandingCover[],
  _total: number,
  _palette: readonly string[],
): WallTile[] {
  return [];
}
