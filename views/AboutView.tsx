import { Icons } from '../components/Icons';

type AboutViewProps = {
  onBack: () => void;
};

/** Brand mark, mirroring LandingView and LoginView. */
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
 * The longer ethos statement that didn't fit the landing footer (see
 * TODO.md's "Landing follow-up (b)") gets its own page instead.
 */
export function AboutView({ onBack }: AboutViewProps) {
  return (
    <div className="h-dvh overflow-y-auto bg-vinyl-950 text-white">
      <div className="min-h-full flex flex-col">
        <header className="shrink-0 flex items-center px-4 sm:px-6 py-3 border-b border-white/5">
          <BrandMark />
          <button
            type="button"
            onClick={onBack}
            className="ml-auto px-3 py-2 text-sm text-gray-300 hover:text-white transition-colors"
          >
            Back
          </button>
        </header>

        <main className="flex-1 flex justify-center px-6 py-16 sm:py-24">
          <div className="max-w-xl">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-8">
              Why sleevesnap exists
            </h1>
            <div className="space-y-5 text-sm sm:text-base text-gray-300 leading-relaxed">
              <p>
                Streaming didn&apos;t kill physical media, but it did make it easy to lose track
                of. A catalog can change overnight — an album gets pulled, a service shuts down, a
                subscription lapses. None of that touches the vinyl on your shelf. It&apos;s yours
                the moment you buy it, for as long as you keep it.
              </p>
              <p>
                sleevesnap isn&apos;t trying to replace your collection or tell you how to listen
                to music. It just makes the physical part easier to keep track of. Point your
                phone at a sleeve and it&apos;s logged — title, artist, year, artwork — matched
                against MusicBrainz&apos;s open catalog. Nothing proprietary, nothing locked in.
              </p>
              <p>
                Your collection is a plain file you can export and take with you, any time, to
                any service or none at all. A shelf of records deserves the same basic
                conveniences a streaming library gets — search, sort, browse — without asking you
                to trade ownership for it.
              </p>
            </div>
          </div>
        </main>

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
