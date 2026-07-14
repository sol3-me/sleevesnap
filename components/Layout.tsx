import { Link, Outlet, useLocation } from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { ScanProvider } from '../contexts/ScanContext';
import { Icons } from './Icons';

const navLinkClassName =
  'flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-gray-400 hover:text-white hover:bg-white/5';
const navLinkActiveClassName =
  'flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium transition-colors bg-vinyl-accent/10 text-vinyl-accent';

const mobileNavLinkClassName =
  'flex flex-col items-center gap-0.5 min-w-16 py-2 text-[11px] font-medium text-gray-500 transition-colors';
const mobileNavLinkActiveClassName =
  'flex flex-col items-center gap-0.5 min-w-16 py-2 text-[11px] font-medium text-vinyl-accent transition-colors';

const creditClassName =
  'text-[11px] text-gray-500 px-5 pb-4';

/** The brand mark: a tiny vinyl record next to the wordmark. */
function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 group" activeOptions={{ exact: true }}>
      <span className="relative w-5 h-5 rounded-full bg-gradient-to-br from-vinyl-accent to-red-500 shadow-[0_0_12px_rgba(255,107,107,0.35)] transition-transform group-hover:rotate-45 duration-500">
        <span className="absolute inset-[6px] rounded-full bg-vinyl-950"></span>
      </span>
      <span className="text-lg font-bold tracking-tight text-white">
        sleeve<span className="text-vinyl-accent">snap</span>
      </span>
    </Link>
  );
}

export function RootLayout() {
  const location = useLocation();
  const isScanRoute = location.pathname === '/scan';

  return (
    <ScanProvider>
      <div className="flex h-screen bg-vinyl-950 text-white overflow-hidden">
        {/* Sidebar (Desktop) */}
        <aside className="hidden md:flex flex-col w-60 border-r border-white/5">
          <div className="px-5 pt-6 pb-8">
            <Logo />
          </div>
          <nav className="flex-1 px-3 space-y-1">
            <Link to="/" className={navLinkClassName} activeProps={{ className: navLinkActiveClassName }} activeOptions={{ exact: true }}>
              <Icons.Home /> Collection
            </Link>
            <Link to="/discover" className={navLinkClassName} activeProps={{ className: navLinkActiveClassName }}>
              <Icons.Search /> Discover
            </Link>
            <Link to="/scan" className={navLinkClassName} activeProps={{ className: navLinkActiveClassName }}>
              <Icons.Camera /> Scan
            </Link>
          </nav>
          <div className={creditClassName}>
            <a
              href="https://musicbrainz.org"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-300 transition-colors"
            >
              powered by musicbrainz <span aria-label="heart">❤</span>
            </a>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 relative h-full flex flex-col overflow-hidden">
          {/* Mobile Header */}
          <header className="md:hidden flex items-center shrink-0 px-4 py-3 bg-vinyl-950/80 backdrop-blur-xl z-20 border-b border-white/5">
            <Logo />
            <a
              href="https://musicbrainz.org"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
            >
              powered by musicbrainz <span aria-label="heart">❤</span>
            </a>
          </header>

          {/* Scrollable route content — sized to exactly what's left after the header,
              so a page using h-full (like the camera view) never overflows the viewport. */}
          <div className="flex-1 overflow-y-auto scroll-smooth">
            <Outlet />
          </div>

          {/* Mobile Navigation Bar (Bottom Sticky) */}
          {!isScanRoute && (
            <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-vinyl-950/85 backdrop-blur-xl border-t border-white/5 pb-safe">
              <div className="flex items-end justify-around px-4">
                <Link to="/" className={mobileNavLinkClassName} activeProps={{ className: mobileNavLinkActiveClassName }} activeOptions={{ exact: true }}>
                  <Icons.Home />
                  <span>Collection</span>
                </Link>
                <Link to="/scan" aria-label="Scan a record" className="flex flex-col items-center -mt-6 pb-1">
                  <span className="flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-vinyl-accent to-red-500 text-white shadow-lg shadow-vinyl-accent/30 ring-4 ring-vinyl-950 active:scale-95 transition-transform">
                    <Icons.Camera />
                  </span>
                </Link>
                <Link to="/discover" className={mobileNavLinkClassName} activeProps={{ className: mobileNavLinkActiveClassName }}>
                  <Icons.Search />
                  <span>Discover</span>
                </Link>
              </div>
            </nav>
          )}
        </main>
        <Toaster theme="dark" position="bottom-right" />
      </div>
    </ScanProvider>
  );
}
