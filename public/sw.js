/*
 * sleevesnap service worker — client-side cache for cover art.
 *
 * The logged-out landing wall loads up to 40 cover images per view, and a
 * few cache-cold refreshes used to exhaust the server's shared request
 * budget (429s). Covers are immutable — keyed by MusicBrainz id and never
 * rewritten — so a cache-first strategy is safe and permanent: once a cover
 * is in the Cache Storage, repeat visits serve it locally and make zero
 * network requests. This works even when the browser's HTTP cache is
 * bypassed (e.g. DevTools "Disable cache"), which plain Cache-Control
 * headers do not.
 *
 * Scope is limited to same-origin GET /covers/ requests; everything else
 * (the app shell, API calls, HMR) falls through to the network untouched.
 */
const COVER_CACHE = 'sleevesnap-covers-v1';

self.addEventListener('install', () => {
  // Take over as soon as installed rather than waiting for all old tabs to
  // close, so the cache starts helping on the very next navigation.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop superseded cover-cache versions (bump COVER_CACHE to purge).
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('sleevesnap-covers-') && name !== COVER_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

function isCoverRequest(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  return url.origin === self.location.origin && url.pathname.startsWith('/covers/');
}

self.addEventListener('fetch', (event) => {
  if (!isCoverRequest(event.request)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(COVER_CACHE);
      const cached = await cache.match(event.request);
      if (cached) return cached;

      const response = await fetch(event.request);
      // Only cache real hits; a 404/429/5xx should be retried next time.
      if (response.ok) {
        await cache.put(event.request, response.clone());
      }
      return response;
    })(),
  );
});
