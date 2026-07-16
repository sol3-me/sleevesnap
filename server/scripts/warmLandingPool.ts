/**
 * One-off (idempotent) warm of the landing cover pool: fetches and stores
 * every pool cover that isn't cached yet, spaced 1.2s apart to respect
 * MusicBrainz's 1 req/s limit, then reports coverage. Safe to re-run any
 * time — cached entries are skipped, so a full pool costs zero requests.
 *
 * Usage: npm run warm:landing
 */
import 'dotenv/config';
import { initDb } from '../db.js';
import { fetchAndStoreAlbumCover } from '../services/coverFetcher.js';
import { getCachedLandingCovers, warmLandingCovers } from '../services/landingCovers.js';
import { LANDING_POOL } from '../services/landingPool.js';
import { createStorageProvider } from '../storage/index.js';

initDb();
const storage = createStorageProvider();

const alreadyCached = getCachedLandingCovers(LANDING_POOL.length).length;
console.log(
  `[warm] Landing pool: ${LANDING_POOL.length} albums, ${alreadyCached} already cached, warming the rest…`,
);

await warmLandingCovers(
  LANDING_POOL,
  (artist, album) => fetchAndStoreAlbumCover(artist, album, storage),
  1200,
);

const warmed = getCachedLandingCovers(LANDING_POOL.length);
const have = new Set(warmed.map((c) => `${c.artist}::${c.album}`));
console.log(`[warm] Done: ${warmed.length}/${LANDING_POOL.length} covers cached.`);
for (const entry of LANDING_POOL) {
  if (!have.has(`${entry.artist}::${entry.album}`)) {
    console.log(`[warm] Still missing: ${entry.artist} - ${entry.album}`);
  }
}
