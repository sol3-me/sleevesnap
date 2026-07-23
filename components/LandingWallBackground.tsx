import type { WallTile } from '../lib/landingWall';

/**
 * The album-art wall + dark overlay backdrop shared by the landing page and
 * About page. Absolutely positioned, so the parent needs `relative` (and
 * usually `overflow-hidden`) sized to the area it should cover.
 */
export function LandingWallBackground({ tiles }: { tiles: WallTile[] }) {
  return (
    <div className="absolute inset-0 bg-vinyl-950" aria-hidden="true">
      <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-1 p-1">
        {tiles.map((tile, i) =>
          tile.kind === 'cover' ? (
            <img
              key={i}
              src={tile.url}
              alt=""
              className="aspect-square w-full object-cover rounded-sm"
            />
          ) : (
            <div
              key={i}
              className="aspect-square w-full rounded-sm"
              style={{ backgroundColor: tile.color }}
            ></div>
          ),
        )}
      </div>
      <div className="absolute inset-0 bg-vinyl-950/80"></div>
    </div>
  );
}
