import React, { useEffect, useMemo, useState } from 'react';
import { Icons } from '../components/Icons';
import { DEMO_PHASE_MS, advanceDemo, type DemoState } from '../lib/landingDemo';
import {
  buildWallTiles,
  pickWallCovers,
  wallTileCountFor,
  type LandingCover,
} from '../lib/landingWall';

// Muted sleeve-ish tones for tiles the cover cache can't fill yet, so a
// cold cache still reads as a wall of records rather than a broken grid.
const WALL_PALETTE = [
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

type LandingViewProps = {
  onSignIn: () => void;
  onSignUp: () => void;
};

function CameraIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

/** Brand mark, mirroring LoginView and the in-app logo. */
function BrandMark() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="relative w-7 h-7 rounded-full bg-gradient-to-br from-vinyl-accent to-red-500 shadow-[0_0_18px_rgba(255,107,107,0.35)]">
        <span className="absolute inset-[9px] rounded-full bg-vinyl-950"></span>
      </span>
      <span className="text-xl font-bold tracking-tight">
        sleeve<span className="text-vinyl-accent">snap</span>
      </span>
    </span>
  );
}

/**
 * Looping scripted scan cycling through real pool albums: the viewfinder
 * breathes over the cover while skeleton lines "search", the Scanner's
 * Snap! stamp fires, then the matched card appears — and the demo moves
 * on to the next album.
 */
function DemoPhone({ albums }: { albums: LandingCover[] }) {
  const [demo, setDemo] = useState<DemoState>({ phase: 'scanning', albumIndex: 0 });
  const albumCount = Math.max(albums.length, 1);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDemo((state) => advanceDemo(state, albumCount)),
      DEMO_PHASE_MS[demo.phase],
    );
    return () => window.clearTimeout(timer);
  }, [demo, albumCount]);

  const album = albums.length > 0 ? albums[demo.albumIndex % albums.length] : null;

  return (
    <div
      className="w-48 shrink-0 rounded-3xl bg-vinyl-900 border border-white/10 p-2.5"
      aria-hidden="true"
    >
      <div className="rounded-2xl bg-vinyl-850 overflow-hidden">
        <div className="relative h-32 bg-vinyl-800 flex items-center justify-center">
          {album ? (
            <img src={album.url} alt="" className="w-20 h-20 rounded-sm object-cover" />
          ) : (
            <span className="w-16 h-16 rounded-sm bg-vinyl-600 flex items-center justify-center text-vinyl-muted">
              <Icons.Disc />
            </span>
          )}
          {demo.phase === 'scanning' && (
            <span className="absolute inset-3 rounded-lg border-2 border-vinyl-accent animate-pulse"></span>
          )}
          {/* Capture flash — mirrors the real Scanner's white shutter flash. */}
          <div
            className={`absolute inset-0 bg-white pointer-events-none transition-opacity ${
              demo.phase === 'snap' ? 'opacity-80 duration-100' : 'opacity-0 duration-200'
            }`}
          ></div>
          {demo.phase === 'snap' && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="px-3 py-1 rounded-xl border-4 border-vinyl-accent text-vinyl-accent font-black text-lg tracking-widest uppercase animate-stamp-pop [-webkit-text-stroke:1.5px_var(--color-snap-outline)] shadow-[0_0_0_3px_var(--color-snap-outline),inset_0_0_0_2px_var(--color-snap-outline)]">
                Snap!
              </div>
            </div>
          )}
        </div>
        <div className="p-3 min-h-[86px]">
          {demo.phase === 'result' ? (
            <>
              <p className="text-xs font-semibold text-white truncate">
                {album?.album ?? 'Your record'}
              </p>
              <p className="text-[11px] text-gray-400 mb-2 truncate">{album?.artist ?? ''}</p>
              <div className="flex items-center justify-center gap-1 rounded-md bg-emerald-500/15 text-emerald-400 text-[11px] py-1">
                <svg
                  viewBox="0 0 24 24"
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                On your shelf
              </div>
            </>
          ) : (
            <>
              <div className="h-3 w-3/4 rounded bg-white/10 animate-pulse mb-2"></div>
              <div className="h-3 w-1/2 rounded bg-white/10 animate-pulse mb-3"></div>
              <div className="h-5 rounded-md bg-white/5 animate-pulse"></div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Logged-out landing page: album-art wall + ownership pitch, a scripted
 * scan demo, and an ethos footer. The wall is real cover art randomised
 * from the curated landing pool (public endpoint, cache-backed), padded
 * with flat colour tiles while the pool warms.
 */
export function LandingView({ onSignIn, onSignUp }: LandingViewProps) {
  const [covers, setCovers] = useState<LandingCover[]>([]);
  const [tileCount, setTileCount] = useState(() => wallTileCountFor(window.innerWidth));

  // Fetch the whole pool of web-optimized thumbnails once, then preload every
  // one into the browser cache. Covers are tiny (~256px JPEGs) and immutably
  // cached, so a first visit pulls a couple of MB and every later refresh —
  // which reshuffles the wall — is served entirely from cache.
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

  // Fewer tiles on mobile, more on desktop; wallTileCountFor returns
  // bucketed values, so resize only re-renders on a breakpoint change.
  useEffect(() => {
    const onResize = () => setTileCount(wallTileCountFor(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Random, no-duplicate selection — reshuffles on every visit. The whole
  // pool is preloaded, so each pick is a cache hit.
  const tiles = useMemo(
    () => buildWallTiles(pickWallCovers(covers, tileCount), tileCount, WALL_PALETTE),
    [covers, tileCount],
  );

  const demoAlbums = useMemo(() => pickWallCovers(covers, 3), [covers]);

  const accentButtonClassName =
    'inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold bg-vinyl-accent text-vinyl-950 hover:brightness-110 active:scale-[0.99] transition';

  return (
    // Own scroll viewport (the app shell locks <body> with overflow-hidden).
    // The inner wrapper is at least full height so the footer sits at the
    // bottom on tall screens, but grows to natural content height on short
    // screens so everything scrolls instead of compressing.
    <div className="h-dvh overflow-y-auto bg-vinyl-950 text-white">
      <div className="min-h-full flex flex-col">
        <header className="shrink-0 flex items-center px-4 sm:px-6 py-3 border-b border-white/5">
        <BrandMark />
        <div className="ml-auto flex items-center gap-1 sm:gap-3">
          <button
            type="button"
            onClick={onSignIn}
            className="px-3 py-2 text-sm text-gray-300 hover:text-white transition-colors"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={onSignUp}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-vinyl-accent/40 text-vinyl-accent bg-vinyl-accent/10 hover:bg-vinyl-accent/20 hover:border-vinyl-accent/60 transition-colors"
          >
            <CameraIcon />
            Scan
          </button>
        </div>
      </header>

      <section className="shrink-0 relative overflow-hidden border-b border-white/5 lg:min-h-[60vh] lg:flex lg:items-center">
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

        <div className="relative w-full flex flex-col items-center text-center px-6 py-16 sm:py-24">
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mb-4">
            Your music. Actually yours.
          </h1>
          <p className="text-sm sm:text-base text-gray-300 leading-relaxed max-w-xl mb-7">
            Streaming apps can pull an album overnight. The records on your shelf aren&apos;t going
            anywhere. sleevesnap helps you keep track of the music you actually own.
          </p>
          <div className="flex items-center gap-4">
            <button type="button" onClick={onSignUp} className={accentButtonClassName}>
              <CameraIcon />
              Try a demo scan
            </button>
          </div>
        </div>
      </section>

      <section
        id="landing-demo"
        className="flex-1 lg:min-h-[40vh] flex flex-col sm:flex-row items-center justify-center gap-10 px-6 py-14 sm:py-20 scroll-mt-4"
      >
        <DemoPhone albums={demoAlbums} />
        <div className="max-w-md text-center sm:text-left">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight mb-5">
            Adding a record takes about five seconds
          </h2>
          <ol className="space-y-3.5 mb-8">
            <li className="flex gap-3 items-baseline justify-center sm:justify-start">
              <span className="text-vinyl-accent text-sm font-semibold shrink-0">1</span>
              <span className="text-sm text-gray-300">Point your phone at the cover</span>
            </li>
            <li className="flex gap-3 items-baseline justify-center sm:justify-start">
              <span className="text-vinyl-accent text-sm font-semibold shrink-0">2</span>
              <span className="text-sm text-gray-300">
                It recognises the record — title, artist, year, artwork
              </span>
            </li>
            <li className="flex gap-3 items-baseline justify-center sm:justify-start">
              <span className="text-vinyl-accent text-sm font-semibold shrink-0">3</span>
              <span className="text-sm text-gray-300">It&apos;s on your shelf. Next one.</span>
            </li>
          </ol>
          <button type="button" onClick={onSignUp} className={accentButtonClassName}>
            Start your shelf — it&apos;s free
          </button>
        </div>
      </section>

        <footer className="shrink-0 border-t border-white/5 px-4 py-5 flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-[11px] text-gray-500">
          <span className="flex items-center gap-1.5">
            <Icons.Database /> Runs on MusicBrainz, open music data
          </span>
          <span className="flex items-center gap-1.5">
            <Icons.LockOpen /> Your library leaves with you, any time
          </span>
          <span className="flex items-center gap-1.5">
            <Icons.Coins /> Free, no ads
          </span>
        </footer>
      </div>
    </div>
  );
}
