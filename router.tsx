import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { RootLayout } from './components/Layout';
import { NotFoundRedirect } from './components/NotFoundRedirect';
import { ArtistDetailView } from './views/ArtistDetailView';
import { CollectionView } from './views/CollectionView';
import { DiscoverView } from './views/DiscoverView';
import { LabelDetailView } from './views/LabelDetailView';
import { ScanView } from './views/ScanView';

const rootRoute = createRootRoute({
  component: RootLayout,
  // Covers the auth-transition edge case: right after sign-in the browser
  // URL can still be /login or /signup (owned by publicRouter, not this
  // tree) for a moment — bounce to / instead of a dead page.
  notFoundComponent: NotFoundRedirect,
});

// `highlight` carries a just-confirmed "already in your collection" record
// id so it can be scrolled into view and briefly ring-highlighted, then the
// param is cleared (see CollectionView) rather than living in state that's
// lost on refresh.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: CollectionView,
  validateSearch: (search: Record<string, unknown>): { highlight?: string } => ({
    highlight: typeof search.highlight === 'string' ? search.highlight : undefined,
  }),
});

const discoverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/discover',
  component: DiscoverView,
  validateSearch: (search: Record<string, unknown>): {
    q?: string;
    page?: number;
    m?: 'simple' | 'advanced';
    st?: 'title' | 'artist' | 'label';
    aid?: string;
    an?: string;
    lid?: string;
    ln?: string;
    title?: string;
    artist?: string;
    year?: string;
    label?: string;
  } => ({
    q: typeof search.q === 'string' ? search.q : undefined,
    page: typeof search.page === 'number' && Number.isFinite(search.page) ? search.page : undefined,
    m: search.m === 'advanced' || search.m === 'simple' ? search.m : undefined,
    st: search.st === 'title' || search.st === 'artist' || search.st === 'label' ? search.st : undefined,
    aid: typeof search.aid === 'string' ? search.aid : undefined,
    an: typeof search.an === 'string' ? search.an : undefined,
    lid: typeof search.lid === 'string' ? search.lid : undefined,
    ln: typeof search.ln === 'string' ? search.ln : undefined,
    title: typeof search.title === 'string' ? search.title : undefined,
    artist: typeof search.artist === 'string' ? search.artist : undefined,
    year: typeof search.year === 'string' ? search.year : undefined,
    label: typeof search.label === 'string' ? search.label : undefined,
  }),
});

const scanRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/scan',
  component: ScanView,
});

const artistDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/artists/$artistId',
  component: ArtistDetailView,
  validateSearch: (search: Record<string, unknown>): { name?: string; page?: number } => ({
    name: typeof search.name === 'string' ? search.name : undefined,
    page: typeof search.page === 'number' && Number.isFinite(search.page) ? search.page : undefined,
  }),
});

const labelDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/labels/$labelId',
  component: LabelDetailView,
  validateSearch: (search: Record<string, unknown>): { name?: string; page?: number } => ({
    name: typeof search.name === 'string' ? search.name : undefined,
    page: typeof search.page === 'number' && Number.isFinite(search.page) ? search.page : undefined,
  }),
});

const routeTree = rootRoute.addChildren([indexRoute, discoverRoute, scanRoute, artistDetailRoute, labelDetailRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
