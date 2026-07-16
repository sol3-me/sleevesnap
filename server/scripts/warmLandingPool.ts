/**
 * One-off (idempotent) warm of the landing cover pool: for every pool entry
 * without a thumbnail, fetches the cover if needed (spaced 1.2s apart to
 * respect MusicBrainz's 1 req/s limit) and generates a web-optimized
 * thumbnail, then reports coverage. Safe to re-run: fully-warmed entries are
 * skipped, and entries that already have a full cover are only thumbnailed
 * (no network, no pause).
 *
 * Usage: npm run warm:landing
 */
import 'dotenv/config';
import { initDb } from '../db.js';
import { getCachedLandingCovers, warmLandingCover, warmLandingCovers } from '../services/landingCovers.js';
import { LANDING_POOL } from '../services/landingPool.js';
import { createStorageProvider } from '../storage/index.js';

initDb();
const storage = createStorageProvider();

const alreadyWarmed = getCachedLandingCovers(LANDING_POOL.length).length;
console.log(
  `[warm] Landing pool: ${LANDING_POOL.length} albums, ${alreadyWarmed} already cached, warming the rest…`,
);

await warmLandingCovers(
  LANDING_POOL,
  (artist, album, existingCoverUrl) => warmLandingCover(artist, album, existingCoverUrl, storage),
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
