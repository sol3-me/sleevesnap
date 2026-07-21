import { Link, Outlet, useLocation } from '@tanstack/react-router';
import type { User } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { ScanProvider } from '../contexts/ScanContext';
import { Icons } from './Icons';

const providerLabels: Record<string, string> = {
  'google.com': 'Google',
  'github.com': 'GitHub',
  password: 'Email',
};

/** Friendly label for the sign-in method behind this account, e.g. "Google". */
function getProviderLabel(user: User): string | null {
  const providerId = user.providerData[0]?.providerId;
  return providerId ? providerLabels[providerId] ?? null : null;
}

/** Compact account row: avatar (or initial), name/email, sign-out. */
function AccountSection() {
  const { user, signOut } = useAuth();
  if (!user) return null;

  const label = user.displayName ?? user.email ?? 'Signed in';
  const initial = label.charAt(0).toUpperCase();
  const providerLabel = getProviderLabel(user);
  // Primary line already shows the email when there's no display name, so
  // only repeat it here alongside the provider when a display name pushed it down.
  const secondaryLine = user.displayName && user.email
    ? providerLabel ? `${user.email} · ${providerLabel}` : user.email
    : providerLabel;

  return (
    <div className="px-3 pb-3">
      <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl bg-white/[0.03] border border-white/5">
        {user.photoURL ? (
          <img
            src={user.photoURL}
            alt=""
            referrerPolicy="no-referrer"
            className="w-8 h-8 rounded-full shrink-0"
          />
        ) : (
          <span className="flex items-center justify-center w-8 h-8 rounded-full shrink-0 bg-vinyl-accent/20 text-vinyl-accent text-sm font-semibold">
            {initial}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-white truncate">{label}</p>
          {secondaryLine && (
            <p className="text-[11px] text-gray-500 truncate">{secondaryLine}</p>
          )}
        </div>
        <Link
          to="/settings"
          title="Settings"
          aria-label="Settings"
          className="shrink-0 p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
        >
          <Icons.Settings />
        </Link>
        <button
          type="button"
          onClick={() => void signOut()}
          title="Sign out"
          aria-label="Sign out"
          className="shrink-0 p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

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

/** Mobile-header sign-out: icon-only, since the sidebar (and its account row) is hidden below md. */
function MobileSignOutButton() {
  const { user, signOut } = useAuth();
  if (!user) return null;

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      title="Sign out"
      aria-label="Sign out"
      className="shrink-0 p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
    >
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
    </button>
  );
}

interface LatestRelease {
  tag_name?: string;
  html_url?: string;
}

/** Live release tag from GitHub Releases, falling back to the build-time version until one exists. */
function VersionBadge() {
  const [release, setRelease] = useState<LatestRelease | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('https://api.github.com/repos/sol3-me/sleevesnap/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then((res) => (res.ok ? (res.json() as Promise<LatestRelease>) : null))
      .then((data) => {
        if (!cancelled && data?.tag_name) setRelease(data);
      })
      .catch(() => {
        // Keep the build-time fallback if the request fails.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (release?.tag_name) {
    return (
      <a
        href={release.html_url ?? 'https://github.com/sol3-me/sleevesnap/releases/latest'}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-gray-300 transition-colors"
      >
        {release.tag_name}
      </a>
    );
  }

  return <span>v{__APP_VERSION__}</span>;
}

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
      <div className="flex h-dvh bg-vinyl-950 text-white overflow-hidden">
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
          <AccountSection />
          <div className={creditClassName}>
            <div>
              <a
                href="https://musicbrainz.org"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-gray-300 transition-colors"
              >
                powered by musicbrainz <span aria-label="heart">❤</span>
              </a>
            </div>
            <div className="flex items-center justify-between gap-2 mt-1">
              <a
                href="https://github.com/sol3uk"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-gray-300 transition-colors"
              >
                made by sol3uk
              </a>
              <VersionBadge />
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 relative h-full flex flex-col overflow-hidden">
          {/* Mobile Header */}
          <header className="md:hidden flex items-center gap-3 shrink-0 px-4 py-3 bg-vinyl-950/80 backdrop-blur-xl z-20 border-b border-white/5">
            <Logo />
            <a
              href="https://musicbrainz.org"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
            >
              powered by musicbrainz <span aria-label="heart">❤</span>
            </a>
            <Link
              to="/settings"
              title="Settings"
              aria-label="Settings"
              className="shrink-0 p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
            >
              <Icons.Settings />
            </Link>
            <MobileSignOutButton />
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
        <Toaster theme="dark" position="top-center" richColors />
      </div>
    </ScanProvider>
  );
}
