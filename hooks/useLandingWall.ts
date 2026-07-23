import { useEffect, useMemo, useState } from 'react';
import {
  buildWallTiles,
  pickWallCovers,
  wallTileCountFor,
  type LandingCover,
  type WallTile,
} from '../lib/landingWall';

/**
 * Fetches the whole pool of web-optimized thumbnails once, then preloads
 * every one into the browser cache. Covers are tiny (~256px JPEGs) and
 * immutably cached, so a first visit pulls a couple of MB and every later
 * refresh (which reshuffles the wall) is served entirely from cache.
 */
export function useLandingCovers(): LandingCover[] {
  const [covers, setCovers] = useState<LandingCover[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/landing/covers')
      .then((res) => (res.ok ? res.json() : { covers: [] }))
      .then((data: { covers?: LandingCover[] }) => {
        if (cancelled || !Array.isArray(data.covers)) return;
        setCovers(data.covers);
        for (const cover of data.covers) {
          const img = new Image();
          img.src = cover.url;
        }
      })
      .catch(() => {
        // The wall degrades to palette tiles; nothing to surface.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return covers;
}

/**
 * Lays out `covers` into a full grid of wall tiles for the given `palette`,
 * re-picking (fewer tiles on mobile, more on desktop) on breakpoint changes.
 * Random, no-duplicate selection reshuffles on every visit — the whole pool
 * is preloaded by `useLandingCovers`, so each pick is a cache hit.
 */
export function useLandingWallTiles(
  covers: readonly LandingCover[],
  palette: readonly string[],
): WallTile[] {
  const [tileCount, setTileCount] = useState(() => wallTileCountFor(window.innerWidth));

  useEffect(() => {
    const onResize = () => setTileCount(wallTileCountFor(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return useMemo(
    () => buildWallTiles(pickWallCovers(covers, tileCount), tileCount, palette),
    [covers, tileCount, palette],
  );
}
