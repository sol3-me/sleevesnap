# sleevesnap UX Improvement Plan

**Status:** Phase 1 ("Stop the bleeding," §8) is implemented — see the ✅ markers below and the updated §8 table. Phases 2–6 are still proposals.
**How it was produced:** a full walkthrough of the running app (desktop + 375px mobile viewports, all four views: Login, Home/Collection, Discover, Scanner) combined with a read of the frontend source (`App.tsx`, `components/*`, `index.html`) and the original `project-roadmap.md`. Library recommendations were checked against current (mid-2026) ecosystem research; sources at the bottom.
**How to use it:** each item is written as a self-contained instruction for a future contributor. Priorities: **P0** = broken or misleading today, **P1** = the "okay → good" gap, **P2** = the "good → amazing" gap. Unimplemented items reference `file:line` as of commit `20311e2` (pre-Phase-1) — line numbers will have drifted for files Phase 1 touched (`App.tsx`, `index.html`); implemented items reference the commit that landed them instead.

---

## 1. Foundations (do these before piling on features)

These aren't cosmetic, but every UX item below gets cheaper and safer once they land.

### 1.1 ✅ (P0) Replace the Tailwind CDN script with the build-time Vite plugin — done (`7d76072`)
`index.html:9` loaded `https://cdn.tailwindcss.com` — the browser-JIT play CDN. It logged a "should not be used in production" warning on every load, re-generated CSS at runtime on every page load, and shipped the entire framework instead of the ~10 KB the app actually uses.

Implemented: `tailwindcss` + `@tailwindcss/vite` installed, plugin added to `vite.config.ts`, new `index.css` with `@import "tailwindcss"` plus a `@theme` block porting the old `vinyl.900/800/700/accent/muted` palette and `spin-slow`. The custom scrollbar and `search-progress` CSS moved from the inline `<style>` block into that file. Both `<script>` tags removed from `index.html`. Verified: no `cdn.tailwindcss.com` request on reload, production build emits a 31 KB (6 KB gzipped) `index-*.css` instead.

### 1.2 ✅ (P0) Stop loading React from esm.sh at runtime — done (`7d76072`)
`index.html:66-74` had an import map pointing `react`/`react-dom` at `https://esm.sh/...`, so a self-hosted app that's supposed to work offline hard-depended on a third-party CDN at boot.

Implemented: import map deleted; Vite bundles React from `node_modules` as normal. Verified via the network log — no `esm.sh` requests on load.

### 1.3 (P0) Introduce real routing — the URL currently carries no state
Navigation is a `useState<ViewState>` (`App.tsx:142`). Consequences observed live: refreshing always dumps you on Home; the browser back button exits the site instead of going back a view; you can't link anyone (or yourself, in another tab) to a search; signing out and back in loses your Discover results; opening a specific record is impossible because records have no URL.

Fix: adopt a router and make these routes: `/` (collection), `/collection/:id` (detail — see §3.2), `/discover?q=…&page=…&formats=…&types=…`, `/scan`. Two solid options:

- **TanStack Router** — typed search params are a genuinely good fit here: the Discover query/page/filter state is exactly the "URL maps to validated state" model it's built around, and it integrates tightly with TanStack Query (§1.4). This is my recommendation.
- **React Router v7** — the conservative, most-hired-for choice; fine if the team prefers familiarity.

Once routing exists, delete `ViewState`, the `view` state, and the hand-rolled nav-highlighting ternaries (`App.tsx:929-946`, `998-1014`).

### 1.4 (P1) Move server state to TanStack Query
Every mutation today manually refetches the whole collection: `setCollection(await getCollection())` appears in add, remove, and scan-complete paths (`App.tsx:200`, `213`, `979`). There's no caching, no optimistic updates, no retry, and a failed refetch leaves stale UI silently. TanStack Query gives: instant optimistic add/remove (the "Add to Collection" button flipping green *immediately*, rolling back on error), background refetch, and deduped requests. The `isReleaseOwned`/`isGroupOwned` memos in `App.tsx` stay as-is — they just read from the query cache instead of local state.

### 1.5 (P1) Split `App.tsx` (1,044 lines) and fix the inline-component anti-pattern
`DashboardView` and `LoginView` are components *defined inside* `App()` (`App.tsx:585`, `~555`) and rendered as `<DashboardView />`. React treats a freshly-created function as a new component type each render, so the whole subtree unmounts/remounts whenever `App` re-renders — this discards image load state, focus, and scroll, and is why the collection grid can visibly flicker when a toast fires. Move them to `views/CollectionView.tsx`, `views/DiscoverView.tsx` (currently the `renderSearchView()` function), `views/LoginView.tsx`, and keep `App.tsx` as shell + providers. The bucket/filter helper functions at the top of `App.tsx` should move to `lib/filters.ts` with unit tests.

### 1.6 (P0) Decide what the login actually is — right now it's theater
The login screen accepts any name, fabricates an email (`ben@sleevesnap.app`), and stores a profile in localStorage — while **all collection data lives server-side with no user scoping**. Two people "logging in" with different names see and edit the same collection. That's misleading in a way that erodes trust the moment a user notices. Also: on mobile there is **no sign-out at all** (the only Sign Out button lives in the desktop-only sidebar, `App.tsx:956`).

Pick one:
- **(Recommended for a self-hosted single-user app)** Delete the login entirely. Boot straight into the collection. Keep a display name in a small Settings page if the greeting is wanted. This removes a whole view, a fake-auth service, and a lie.
- If multi-user is genuinely on the roadmap, do it properly (the original roadmap said Firebase Auth; for self-hosted, an `Authorization` header + user column on `collection` is the honest minimum) — but don't ship name-only "auth" in the meantime.

### 1.7 (P2) Ship the PWA the roadmap promised
No manifest, no service worker, no icons today. Use `vite-plugin-pwa`: app-shell precache, runtime cache for Cover Art Archive images (`coverartarchive.org`, stale-while-revalidate), maskable icons, `theme_color: #121212`. This is what makes "add to home screen → open in the record store → scan" feel native, which is the core use case. Depends on 1.1/1.2 (no CDN dependencies) to be meaningful.

---

## 2. Defects and broken layouts found in the live walkthrough

All of these were observed, not hypothesized. Ordered by severity.

### 2.1 ✅ (P0) Mobile Discover cards are crushed to unreadable — done (`ffd8dad`)
At 375px, a release-group card rendered its title as a single letter ("C") with metadata wrapping one word per line, because the row was: 80px thumbnail + flexible text + a `min-w-[180px]` "Show releases" control, all forced into one horizontal flex row.

Implemented: the header stacks vertically below `sm:` (`flex-col sm:flex-row`), the "Show releases" control is full-width on mobile / auto-width with `sm:min-w-[160px]` on desktop, and the fixed 180px min-width is gone. Verified live at 375px — title, artist, metadata, and both external links now render fully alongside a proper "ALBUM" badge, with a full-width "Show releases" affordance below.

### 2.2 ✅ (P0) The group-level "In Collection" badge truncates to "IN C…" — done (`ffd8dad`)
The `primaryType` and owned badges were rendered *inside* the `truncate` `<h3>`, so any longish title ellipsized the badges themselves — observed live as "IN C…" on the Queens of the Stone Age card.

Implemented: restructured to a `<div className="flex items-center gap-2">` containing `<h3 className="truncate min-w-0">{title}</h3>` and a `shrink-0` wrapper for the badges, so the title truncates and badges always render in full. Verified live — "ALBUM" and "In Collection" badges both show completely at 375px.

### 2.3 ✅ (P0) `<a>` elements nested inside a `<button>` on every Discover card — done (`ffd8dad`)
The entire group header was a `<button>` containing the MusicBrainz/Discogs `<a>` links — invalid HTML, and the accessibility tree showed the links folded into the button's accessible name.

Implemented: the header is now a plain `<div onClick={...}>` (still expands on click for mouse users, with the links calling `stopPropagation`), and "Show releases" is its own real `<button aria-expanded>`. Verified via the accessibility snapshot — each link is now a sibling `link` node, not swallowed into a button's name, and there's a discrete `button: "Show releases ⌄"`.

### 2.4 ✅ (P1) Mobile collection grid shows one giant card per row at 375px — done (`ffd8dad`)
`minmax(clamp(140px, 44vw, 190px), 1fr)` fell back to a single column at 375px because the two-column math didn't fit within the padded container.

Implemented: simplified to `minmax(150px, 1fr)`. Verified live at 375px — the collection grid renders 2 columns.

### 2.5 ✅ (P0) "Remove" is instant, permanent, and unconfirmed — done (`de88c4f`)
`handleRemoveFromCollection` called a hard `DELETE` immediately; one mis-tap silently destroyed a record with a toast offering nothing.

Implemented: the record is hidden from the UI immediately, but the actual `DELETE` is deferred 5 seconds (`REMOVE_UNDO_WINDOW_MS`); the toast shown during that window has an "Undo" action that cancels the pending delete and restores the record. Verified live (and by directly exercising the API): removing a record hides it immediately, clicking Undo restores it with **no** `DELETE` ever reaching the server, and letting the window elapse does send the `DELETE`.

**Known limitation, follow-up for §1.4/§3.2:** the undo window is purely client-side (a `setTimeout`, cleared on unmount). If the tab is closed or the app is force-navigated away within the 5s window, the timer never fires — the record was visually removed but never actually deleted server-side, so it silently reappears next load. A durable fix means either a server-side soft-delete flag (the originally-considered approach) or moving this onto TanStack Query's mutation lifecycle once §1.4 lands. Low-risk in the meantime: worst case is a record you thought you removed still being there, not data loss.

### 2.6 ✅ (P1) The toast system needs replacing — done (`de88c4f`)
One global `notification` string with a 3-second timer: consecutive events overwrote each other, `animate-bounce` bounced *forever*, no dismiss, no action slot, no aria-live.

Implemented: replaced with **sonner** — `<Toaster theme="dark" position="bottom-right" />` mounted in both the logged-out and logged-in render branches, all `showNotification` call sites converted to `toast.success` / `toast.error` / `toast()`, and the Undo action (§2.5) uses sonner's `action` slot. The hand-rolled `notification` state is deleted.

### 2.7 (P1) Filter dropdown accessibility is wrong-shaped
`FilterDropdown.tsx` uses `role="menu"` around checkboxes. Menus are for commands; this is a multi-select. Use `role="listbox"` + `aria-multiselectable` with `role="option"`/`aria-selected` (or Base UI's Select/Popover primitives via shadcn, §6.1, and delete the hand-rolled outside-click/Escape code entirely). Also add arrow-key navigation between options and return focus to the trigger on close.

### 2.8 (P2) Scanner view breaks the app's background
`Scanner.tsx:296` uses `bg-black` while every other view sits on `bg-vinyl-900` (#121212). Small, but the jump is visible on every scan. Use the shared token.

### 2.9 (P1) Search state silently persists filters across sessions
Format/type filters persist to localStorage (`sleevesnap:search-filters:v2`), which is good — but a user who unchecked "CD" three weeks ago and searches today sees fewer results with only a subtle "(2 of 3)" count badge explaining why. When any filter is narrowing results, show an inline dismissible hint next to the results count: "Some results hidden by filters — Reset". A one-click reset-all-filters affordance doesn't exist today; add it.

---

## 3. Collection view: from a grid of cards to a collection manager

The Home view is currently: a count, a size slider, and cards with three external links and a Remove button. For a collector this is the heart of the app, and it's the thinnest view. This is the biggest "okay → amazing" lever.

### 3.1 (P1) Sort, filter, and search within the collection
Non-negotiable table stakes once a collection passes ~20 records. Add a toolbar: text filter (artist/title, client-side), sort select (Recently added — current default, Artist A–Z, Release year, Title), and reuse `FilterDropdown` for format/genre. All state in the URL (§1.3). The backend already returns the full collection; this is purely client work.

### 3.2 (P1) A record detail view — records currently have no page
Clicking a card does nothing today (the only click targets are external links and Remove). Every comparable product (Discogs, Music Collector, Disc Cover apps) has a detail view. Route: `/collection/:id`, rendered as a modal over the grid on desktop, full page on mobile. Contents: large cover (the scanned photo when one exists, with a toggle to the canonical art), full metadata, the external links, **notes editing (§3.3)**, remove (with undo), and "other pressings you own of this album" (records sharing `releaseGroupId` — the data model already supports this since the per-pressing dedup work).

### 3.3 (P1) Notes: the schema and API support them; no UI writes them
`collection.notes` exists in the DB, flows through both POST routes and `rowToRecord`, and is typed on `VinylRecord` — but there is no input anywhere in the frontend. For collectors, notes are where "bought at Rough Trade 2019, corner ding, plays clean" lives. Add a textarea to the detail view (§3.2) backed by a new `PATCH /api/collection/:id` (which doesn't exist yet — add it with a test, per the repo's red-then-green convention). While adding PATCH, consider `condition` media/sleeve fields (Goldmine grading: M/NM/VG+/VG/G/F — the standard every collector already knows) — that's the single most-requested field class in collection apps.

### 3.4 (P2) Collection insights header
Above the grid: total records, records this month, top format/decade/genre chips. Cheap to compute client-side, makes the collection feel *alive*, and gives the empty header row (currently just "4 Records") a job.

### 3.5 (P2) Export and import
Self-hosted data with no export is a trust problem. Add: CSV export (client-side from the already-loaded collection — artist, title, year, format, country, MBIDs, notes, date added), and later a Discogs collection CSV import (their export format is documented and stable) as the on-ramp for users with existing digital collections. This single feature is a differentiator for switchers.

### 3.6 (P2) Stack multiple owned pressings of the same album
Now that owning several pressings of one album is supported, the grid will show near-identical duplicate covers. Group grid items by `releaseGroupId`: one card, a "×2" pressing-count badge, expanding to the pressing list (mirrors Discover's group/release hierarchy, so the mental model is consistent app-wide).

### 3.7 (P2) Replace the card-size slider with a segmented control
The labeled 180–360px slider (`App.tsx:592-605`) is an unusual control for this job — users don't think in pixels. A three-state segmented control (S/M/L) or grid/list toggle covers the real need. Keep localStorage persistence. Low priority; the slider works.

---

## 4. Discover view

### 4.1 (P0-ish P1) Page size 5 is painful — the single biggest Discover irritant
`SEARCH_PAGE_SIZE = 5` (`App.tsx:10`). The walkthrough search ("Queens of the Stone Age") returned **96 release groups = 20 pages** of Prev/Next clicking, each a full round-trip. Nobody pages 20 times.

The constraint to respect: the server enriches each group against MusicBrainz (rate-limited ~1 req/s), so bigger pages mean slower pages — 5 was presumably chosen to keep latency tolerable. Don't just raise the number; change the shape:
- Switch to **"Load more"** (append, keep scroll position) instead of Prev/Next — pagination state stops being destructive.
- Render group cards **immediately from the search response** with skeleton metadata, and let enrichment fill in per-card as it completes (progressive enhancement instead of blocking the whole page on the slowest lookup). This likely needs a server change: return the cheap search hits first, expose enrichment via the existing per-group endpoint the accordion already uses.
- With TanStack Query, prefetch page N+1 while the user reads page N.

### 4.2 (P1) Skeletons, not an indeterminate bar
The current loading state is a spinner + looping progress bar (`App.tsx:702-712`) above an empty region. Replace with 5 skeleton group-cards (gray blocks matching the real card layout). Skeletons set size expectations, reduce perceived wait, and prevent the layout jump when results land.

### 4.3 (P1) Make the "In Collection" story clickable and quantified
The group badge (post-`20311e2`) says you own *a* pressing. Improve: "In Collection ×2" when multiple pressings are owned, and make the badge a link to the collection (filtered to that release group / detail view §3.2). In the expanded release list, the disabled green button is right — add a `title`/tooltip with the date it was added.

### 4.4 (P2) Filter dropdown niceties
Per-option result counts ("Vinyl (37)"), Select all / Clear inside the panel, and applied-filter chips under the search bar with × to remove (the standard e-commerce pattern; it makes hidden-filter states visible, complementing 2.9).

### 4.5 (P2) Keyboard ergonomics
`/` focuses the search input from anywhere (GitHub/YouTube convention); Escape clears focus; Enter already searches. If cmdk lands (§6.6) this folds into it.

### 4.6 (P2) Cover art sizing
Thumbnails come from the search index and are visibly low-res at 80px. Cover Art Archive serves `front-250`/`front-500` by MBID; upgrade the expanded-release thumbs to `front-250` with the existing fallback-chain pattern from `VinylCard.tsx:10-34` (extract that candidate-chain logic into a shared `CoverImage` component — it's currently duplicated as `renderCoverThumb` in `App.tsx` and `failedCovers` maps in two files).

---

## 5. Scanner

The scanner is the app's USP and the flow is already decent (explicit camera opt-in, drag-drop, global paste — all good). Gaps:

### 5.1 (P1) Pressing selection before save — align the scanner with the per-pressing model
The collection is now pressing-specific, but the scanner saves whichever single release the vision suggestion or manual search happens to resolve to. A user scanning their 1998 US pressing may get the 2011 Europe release saved. After the user confirms *the album*, insert one step: "Which pressing is this?" listing that release group's releases (reuse Discover's grouped-release list; the endpoint already exists). Default to the top match with one-tap accept so the fast path stays fast. This is the difference between "logged something" and "logged *my copy*" — the core collector promise.

### 5.2 (P1) The match-found flow dead-ends for multi-pressing owners
When pHash matches an owned record, the only options are "That's it!" (exit) and "Not quite — search". Add "It's the same album, different pressing → pick pressing" (feeds 5.1). Currently a collector scanning their *second* copy of an album they own gets pushed into the wrong flow.

### 5.3 (P2) Multi-record detection (the roadmap's stated USP)
`project-roadmap.md §4` promises detecting *multiple* records in one frame; the UI is single-record end-to-end. When this lands server-side, the UI should become: captured photo with N bounding-box chips → checklist of identified records → resolve each (auto-accept high-confidence, flag the rest) → batch add with one summary toast. Design the `search_results` stage now so it can render N result *groups* rather than one flat list, to avoid a rewrite.

### 5.4 (P2) Analysis progress narration + retry
"Matching sleeve…" is one opaque spinner for a multi-second, multi-step pipeline. Show the real stages ("Checking your collection… / Asking the vision model… / Looking up MusicBrainz…") — honest progress, and when something fails users know *which* step to blame. Every error state should have an explicit Retry that reuses the captured image (currently a failure drops to manual search and the retry path is "Scan again" = recapture).

### 5.5 (P2) Camera framing guide
Overlay a centered square guide ("fill the frame with the sleeve") on the live feed. Sleeves are square; the pHash match quality depends on framing; a guide is ~10 lines of absolutely-positioned CSS.

---

## 6. Design system, look-and-feel, and libraries

The dark "vinyl" palette is a good brand foundation — keep it. The gap is consistency and depth: hand-rolled controls, inline SVGs pasted per-file, no motion language, default-y focus states.

### 6.1 (P1) Adopt shadcn/ui for interactive primitives
The app is hand-building dropdowns, will need dialogs (detail view, confirmations), tooltips, tabs, and form controls. **shadcn/ui** is the 2026 default for Tailwind+React apps — copy-paste components, no runtime dependency lock-in, and as of 2026 it sits on **Base UI** primitives (the actively-staffed successor to Radix, built by the same engineers; new projects default to it, Radix remains fine but its development has slowed since the WorkOS acquisition). Bring in: `dialog`, `dropdown-menu`/`popover`+`command`, `tooltip`, `select`, `tabs`, `skeleton`, `badge`, `sonner`. Restyle tokens to the vinyl palette in one place. Replace `FilterDropdown.tsx` with the Popover+Checkbox composition and delete its manual outside-click/Escape plumbing.

### 6.2 (P1) sonner for toasts
Covered in 2.6/2.5 — 9 KB gzipped, action buttons (Undo), queueing, aria-live, dark theme out of the box. It is the current ecosystem default by a wide margin.

### 6.3 (P1) lucide-react for icons
`App.tsx` and `Scanner.tsx` carry hand-pasted inline SVG components (`Icons.Home`, `CameraIcon`, …). `lucide-react` is tree-shakeable, consistent stroke-width, 1,500+ icons, and is what shadcn assumes. Delete the inline SVGs.

### 6.4 (P2) Typography with character
Everything is the Tailwind default stack today. Self-host (via `@fontsource`, keeping the no-CDN rule) a display face for headings with some record-label personality — e.g. **Bricolage Grotesque** or **Clash Display** for `h1/h2`, with **Inter** or **Geist** for UI text. One display font used only at the top level is the cheapest "this app has a designer" signal there is.

### 6.5 (P2) Motion language
Add `motion` (framer-motion) for exactly three things, all under `prefers-reduced-motion` guards: accordion expand/collapse on Discover groups (currently an instant jump), grid item enter/exit on add/remove (`AnimatePresence`), and a subtle card hover lift. Plus one brand moment: the existing `spin-slow` keyframe deserves a small spinning-record loading indicator used consistently for all loading states (search, scan, save) instead of three different spinners.

### 6.6 (P2) Command palette (cmdk)
`Ctrl/Cmd+K`: jump to a record in your collection, "Scan", "Search MusicBrainz for …". Composes with §3.1's client-side collection search almost for free via shadcn's `command` component. Pure delight feature; do it last.

---

## 7. Accessibility pass (P1, one focused sprint)

Beyond 2.3/2.7:
- **Contrast:** `text-gray-500` on `#121212` and on `bg-vinyl-800` is used for load-bearing metadata (dates, formats, MBIDs) and sits near/below WCAG AA 4.5:1. Audit with the browser devtools contrast checker; bump body-copy grays one step (500→400).
- **Focus visibility:** several controls rely on default or removed outlines; standardize a visible `focus-visible:ring-2 ring-vinyl-accent` on every interactive element (shadcn brings this for its components; cover the custom ones).
- **Touch targets:** the per-release "Add to Collection" buttons and card link-chips are ~24px tall on mobile — below the 44px the roadmap itself specifies. Pad them up on touch layouts.
- **aria-live:** toasts (sonner handles it) and the search results-count line should announce.
- **Landmarks/headings:** views jump `h2 → h5` in the release list (`App.tsx:817`); fix the heading ladder.

---

## 8. Suggested delivery order

| Phase | Contents | Outcome | Status |
|---|---|---|---|
| 1. Stop the bleeding | 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6 | No broken mobile views, no destructive mis-taps, production-legit styling pipeline | ✅ Done — `7d76072`, `de88c4f`, `ffd8dad` |
| 2. Skeleton upgrade | 1.3 routing, 1.4 TanStack Query, 1.5 App split, 1.6 login decision | URLs, back button, optimistic UI, maintainable codebase | Not started |
| 3. Collection depth | 3.1, 3.2, 3.3 (+PATCH endpoint), 2.7, 7 | The collection becomes the product's heart | Not started |
| 4. Discover flow | 4.1, 4.2, 4.3, 2.9 | Search that feels fast and honest | Not started |
| 5. Scanner promise | 5.1, 5.2, 5.4 | Scans log *your exact copy* | Not started |
| 6. Delight | 1.7 PWA, 3.4–3.6, 4.4–4.6, 5.3, 5.5, 6.4–6.6 | The "amazing" tier: installable, animated, insightful | Not started |

Each phase should follow the repo's existing convention: failing test first where server behavior changes (PATCH endpoint, progressive enrichment), commit red, then green, and verify live in the browser preview at 375px *and* desktop widths — the mobile crush in 2.1 shipped precisely because verification happened desktop-only.

**Phase 1 verification, for the record:** `npx tsc --noEmit` (frontend) and `npm test` (full backend suite, 4 test files unaffected by these changes) both clean; `npm run build` produces a clean production bundle with build-time CSS (31 KB / 6 KB gzipped) instead of the CDN payload; every fix in §1.1–1.2, §2.1–2.6 was checked live in the browser preview at both 375px and desktop widths, including a direct accessibility-tree check for §2.3 and a real add/remove/undo round-trip against the API for §2.5. Phase 1 touched only `App.tsx`, `index.html`, `index.css` (new), `index.tsx`, `vite.config.ts`, and `package.json` — no backend changes, so no new backend tests were needed.

---

## Research sources

Component libraries / primitives: [Untitled UI — 14 Best React UI Component Libraries in 2026](https://www.untitledui.com/blog/react-component-libraries), [shadcn vs Radix vs Base UI in 2026](https://dev.to/edriso/shadcn-vs-radix-vs-base-ui-which-one-should-a-junior-pick-in-2026-1jml), [Radix vs Base UI (ShadcnDeck)](https://www.shadcndeck.com/blog/radix-vs-base-ui), [GreatFrontend — Top Headless UI libraries for React in 2026](https://www.greatfrontend.com/blog/top-headless-ui-libraries-for-react-in-2026).
Toasts: [PkgPulse — react-hot-toast vs react-toastify vs Sonner 2026](https://www.pkgpulse.com/guides/react-hot-toast-vs-react-toastify-vs-sonner-2026), [peal.dev — Toast Notifications Done Right](https://www.peal.dev/blog/toast-notifications-sonner-react-hot-toast-alternatives), [shadcn/ui — Sonner](https://ui.shadcn.com/docs/components/radix/sonner).
Routing / server state: [TanStack Router vs React Router (Vercel)](https://vercel.com/i/tanstack-router-vs-react-router), [Better Stack — TanStack Router vs React Router](https://betterstack.com/community/guides/scaling-nodejs/tanstack-router-vs-react-router/), [TanStack Router docs](https://tanstack.com/router/latest).
Tailwind v4: [Tailwind CSS v4.0 announcement](https://tailwindcss.com/blog/tailwindcss-v4), [Install Tailwind CSS with Vite](https://tailwindcss.com/docs), [@tailwindcss/vite on npm](https://www.npmjs.com/package/@tailwindcss/vite).
