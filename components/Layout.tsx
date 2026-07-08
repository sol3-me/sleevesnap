import { Link, Outlet, useLocation } from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { ScanProvider } from '../contexts/ScanContext';
import { Icons } from './Icons';

const navLinkClassName = 'flex items-center gap-3 w-full p-3 rounded-lg transition-all text-gray-400 hover:bg-vinyl-700';
const navLinkActiveClassName = 'flex items-center gap-3 w-full p-3 rounded-lg transition-all bg-vinyl-accent text-white';

const mobileNavLinkClassName = 'flex flex-col items-center text-gray-500';
const mobileNavLinkActiveClassName = 'flex flex-col items-center text-vinyl-accent';

const logoClassName = 'text-2xl font-bold text-vinyl-accent flex items-center gap-2';

export function RootLayout() {
  const location = useLocation();
  const isScanRoute = location.pathname === '/scan';

  return (
    <ScanProvider>
      <div className="flex h-screen bg-vinyl-900 text-white overflow-hidden">
        {/* Sidebar (Desktop) */}
        <aside className="hidden md:flex flex-col w-64 bg-vinyl-800 border-r border-vinyl-700">
          <div className="p-6">
            <Link to="/" className={logoClassName} activeOptions={{ exact: true }}>
              <span className="w-3 h-3 bg-white rounded-full"></span>
              sleevesnap
            </Link>
          </div>
          <nav className="flex-1 px-4 space-y-2">
            <Link to="/" className={navLinkClassName} activeProps={{ className: navLinkActiveClassName }} activeOptions={{ exact: true }}>
              <Icons.Home /> Home
            </Link>
            <Link to="/discover" className={navLinkClassName} activeProps={{ className: navLinkActiveClassName }}>
              <Icons.Search /> Search
            </Link>
            <Link to="/scan" className={navLinkClassName} activeProps={{ className: navLinkActiveClassName }}>
              <Icons.Camera /> Scan
            </Link>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 relative overflow-y-auto h-full scroll-smooth">
          {/* Mobile Header */}
          <header className="md:hidden flex items-center p-4 bg-vinyl-800/90 backdrop-blur-md sticky top-0 z-20 border-b border-vinyl-700">
            <Link to="/" className={logoClassName} activeOptions={{ exact: true }}>
              <span className="w-3 h-3 bg-white rounded-full"></span>
              sleevesnap
            </Link>
          </header>

          <Outlet />

          {/* Mobile Navigation Bar (Bottom Sticky) */}
          {!isScanRoute && (
            <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-vinyl-800 border-t border-vinyl-700 flex justify-around p-3 z-30 pb-safe">
              <Link to="/" className={mobileNavLinkClassName} activeProps={{ className: mobileNavLinkActiveClassName }} activeOptions={{ exact: true }}>
                <Icons.Home />
                <span className="text-xs mt-1">Home</span>
              </Link>
              <Link to="/scan" className="flex flex-col items-center -mt-8">
                <div className="bg-vinyl-accent p-4 rounded-full shadow-lg border-4 border-vinyl-900 text-white">
                  <Icons.Camera />
                </div>
              </Link>
              <Link to="/discover" className={mobileNavLinkClassName} activeProps={{ className: mobileNavLinkActiveClassName }}>
                <Icons.Search />
                <span className="text-xs mt-1">Search</span>
              </Link>
            </nav>
          )}
        </main>
        <Toaster theme="dark" position="bottom-right" />
      </div>
    </ScanProvider>
  );
}
