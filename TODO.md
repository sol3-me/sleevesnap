# sleevesnap TODO

Ben's running backlog of next-up ideas — not exhaustively planned, just captured so nothing gets lost between sessions. For implemented/in-progress work with more design detail, see `project-roadmap.md` and `ux-improvement-plan.md`.

_Captured 2026-07-16, right after Firebase Authentication merged to main. Reorganized 2026-07-21 by expected implementation effort (was previously grouped by topic — topic is now a bracketed tag per item instead) so the quickest wins are easy to grab first._

## Recently shipped

- [x] Landing follow-up (b): About page (2026-07-23) — new `/about` route (public router only, same as `/login`/`/signup`) with the longer ethos paragraph that didn't fit the landing footer, linked from a new "About" link in that footer. Note: the original cut paragraph text was never committed anywhere (not in the repo, not in this TODO), so the copy on the page is freshly drafted in the established brand voice (see `landing-page-design.md`) — Ben should review/edit it, it's not a recovered original.
- [x] Let the user pick their own collection cover image (2026-07-23, PR #15, merged to main) — upload-from-device or revert-to-MusicBrainz per record via a new `cover_source` column, `PATCH /api/collection/:id/cover` endpoint, and a cover-picker modal on each collection card. Crop/position adjustment for the uploaded photo remains a separate deferred item (see Large below).
- [x] User settings/preferences page (2026-07-22) — grew the existing `/settings` stub (previously just Danger Zone) with: a read-only Account section (avatar/name/email/provider, reusing `getProviderLabel`, now extracted to `lib/authProviderLabel.ts`); the collection card-size preference (S/M/L) moved from localStorage to a new server-side `user_settings` table so it follows the account across devices; and a Data section with collection Export (downloads a JSON backup) and Import (restores from that file via a new bulk `POST /api/collection/import` endpoint — client-side looping individual POSTs would have blown through `apiLimiter`'s 100 req/min cap for any real collection). Verified live against the Firebase Auth Emulator (see Emulator item below) — signed up, changed card size, reloaded and confirmed it persisted, exported, and re-imported successfully.
- [x] Local Firebase Emulator Suite for dev (found already shipped as `#8` on 2026-07-22 while verifying the settings page above — this TODO entry was stale) — `lib/firebase.ts` connects to the Auth Emulator when `VITE_USE_FIREBASE_EMULATOR=true`; the server side also needs `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` set (firebase-admin picks this up automatically) or every request 401s even with a valid emulator token — worth documenting somewhere more visible than this note. Firestore emulator remains unneeded/unexplored (still no Firestore usage anywhere).
- [x] Clear collection with confirm (2026-07-21, `#7`, merged to main) — confirm dialog before clearing the whole collection.
- [x] Redo the card "size" slider (2026-07-21, `#6`, merged to main) — replaced with an S/M/L control.
- [x] "Show releases" one click too many (2026-07-16/2026-07-22) — quick-add (collect straight from the collapsed group card) shipped on `feature/group-releases-by-format-year`. The auto-expand-single-release half shipped first (`#5`, merged to main) but was then removed on that same branch (2026-07-22) as a side effect of deferring format/release-count fetching to expand-time — `totalReleases` isn't known before a group is expanded anymore, so there's nothing to auto-expand on. If single-release groups still feel like friction, revisit as its own idea once the new lazy-search data model has settled.
- [x] Show the site's release/version number somewhere (2026-07-21) — shipped as part of going public: build-time `__APP_VERSION__` (from `package.json`, injected via Vite) as a fallback, live-fetched from the GitHub Releases API once a release exists. See sidebar credit block in `components/Layout.tsx`.
- [x] Show auth provider type (Google/GitHub/email) next to the user's email in the UI (2026-07-21) — shipped in the same pass, reads `user.providerData[0].providerId`.
- [x] Add "made by sol3uk" next to the "powered by musicbrainz" credit line (2026-07-21) — shipped in the sidebar credit block (desktop only; left the mobile header alone since it was already tight after the squish fix).
- [x] Make the "snap" capture animation clearer/more noticeable and let it linger longer (2026-07-16, not previously checked off here) — slowed further and given ~500ms more linger; outline reworked twice since (text-stroke → stacked-text → text-shadow) for evenness.

## Trivial (single file/line, no design decisions)

_(none currently outstanding — this tier gets drained fast, check back after the next planning pass)_

## Quick (small, scoped, single feature area)

_(none currently outstanding — see Recently shipped below)_

## Medium

- [ ] **[Account & user management]** Delete account request flow
- [ ] **[Collection & UI polish]** Discover page needs content when empty (inspiration/history section) instead of a blank landing state
- [ ] **[Legal/trust]** T&Cs and privacy policy
- [ ] **[Branding]** Standardise and improve the looks of the validation emails the user gets, as well as the landing page after validation, they're currently all very generic

## Large

- [ ] **[Collection & UI polish]** Detail page for a release and for a release group (ties to `ux-improvement-plan.md` §3.2's planned `/collection/:id` detail view)
- [ ] **[Collection & UI polish]** Basic crop/position adjustment for the self-picked collection cover image (nothing fancy, but image-manipulation UI is fiddly even so)
- [ ] **[Observability]** General custom-event telemetry: scans (success/fail), MusicBrainz timeouts/errors, etc. — `services/telemetry.ts` today is just a `console.log` shim (mirrors `server/logger.ts`'s bracket-tag style), not a real event pipeline, so this is new infra, not an upgrade
- [ ] **[Observability]** Telemetry for which accounts are using AI vision tokens (cost/usage attribution per user — the daily vision quota is now per-user, so this is about spend visibility, not fairness) — depends on the general telemetry item above existing first
- [ ] **[Observability]** Consider adding back a deployment-wide vision-spend ceiling — moving the AI-scan quota to per-user (2026-07-16) removed the old shared counter's hard cap on total vision-API spend; VISION_DAILY_LIMIT now bounds each user individually, so spend scales with active users
- [ ] **[Observability]** Uptime alerts + health checks (Ben mentioned "pangolin?" as a possible tool to look into)
- [ ] **[Observability]** User tiers via Firebase Remote Config instead of a DB table (2026-07-16, Ben's call: a `user_limits` DB table + admin page felt like too much machinery for this) — an admin adds/removes emails from a Remote Config parameter (a JSON array, e.g. `admin_tier_emails`) in the Firebase console; the server reads it via firebase-admin's server-side Remote Config SDK (`getRemoteConfig()`/`getServerTemplate()`, Admin SDK v12.1.0+) and evaluates it per-request, so membership changes apply without a restart or redeploy — no client-side Remote Config here, since a quota is exactly the kind of "sensitive control" Firebase's own docs say not to leave to client-evaluated config. Two tiers to start (admins get a higher VISION_DAILY_LIMIT, everyone else gets the default); more tiers later if it's ever needed. Mind Remote Config's fetch/cache interval so console edits don't feel instant-but-actually-lag by a few minutes.

## Undecided / blocked on other work

- [ ] **[Growth & onboarding]** Landing follow-up (a): "Try a demo scan" currently scrolls to the looping animation — re-point it at real guest mode when that ships (blocked on guest mode below, not a sizing issue)
- [ ] **[Growth & onboarding]** Demo/guest-mode-with-transfer-on-signup — agreed direction, needs its own design pass (see `ux-improvement-plan.md`'s Firebase Auth update note)
- [ ] **[Growth & onboarding]** Import collection in batch *from another source* (format/approach still undecided — Discogs CSV import was floated in `ux-improvement-plan.md` §3.5 as one option). Note: this is distinct from the JSON export/import shipped in the settings page (see Recently Shipped) — that's a sleevesnap-to-sleevesnap backup/restore format, not an ingest path for a Discogs/Spotify/etc. export.
- [ ] **[Developer experience]** Firestore as a data store — exploratory only, not decided. We currently have zero persistence inside Firebase (SQLite via better-sqlite3 handles collection/scan-history/quota); this is just a "how would local dev even look" question raised in passing, not a plan to migrate. If it ever becomes real, it rides on the same Emulator Suite already shipped (see Recently Shipped) — Firestore emulator specifically is still unexplored.
- [ ] **[Social]** Share collections with other users
- [ ] **[Social]** Public profiles

## Growth & onboarding — already shipped (kept for history)

- [x] Improved landing page with a feature demo (2026-07-16) — shipped: logged-out front door with an album-art wall (randomised from a curated 36-album pool in `server/services/landingPool.ts`, served self-hosted by the public `/api/landing/covers` endpoint riding the existing cover cache), ownership-ethos hero ("Your music. Actually yours."), scripted phone scan-demo loop, and trust-chip footer. Design chosen from three pitched concepts: manifesto-led hero + chip footer.
- [x] Landing pool one-off grab (2026-07-16) — pool grown to 158 albums; `npm run warm:landing` fetches every uncached cover once (idempotent, 1.2s spacing) into our own storage, so the wall never touches MusicBrainz at page-view time; covers persist on the `sleevesnap_data` Docker volume in prod (run the warm script once there, lazy request-time warmup remains as backstop). Wall selection is now client-side: one fetch of the pool, RNG-into-hash-set picks unique covers, 20/30/40 tiles by viewport breakpoint
