# sleevesnap TODO

Ben's running backlog of next-up ideas — not prioritized or ordered, just captured so nothing gets lost between sessions. For implemented/in-progress work with more design detail, see `project-roadmap.md` and `ux-improvement-plan.md`.

_Captured 2026-07-16, right after Firebase Authentication merged to main._

## Observability

- [ ] Telemetry for which accounts are using AI vision tokens (cost/usage attribution per user — the daily vision quota is now per-user, so this is about spend visibility, not fairness)
- [ ] General custom-event telemetry: scans (success/fail), MusicBrainz timeouts/errors, etc. — `services/telemetry.ts` today is just a `console.log` shim (mirrors `server/logger.ts`'s bracket-tag style), not a real event pipeline, so this is new infra, not an upgrade
- [ ] Uptime alerts + health checks (Ben mentioned "pangolin?" as a possible tool to look into)
- [ ] Show the site's release/version number somewhere
- [ ] Consider adding back a deployment-wide vision-spend ceiling — moving the AI-scan quota to per-user (2026-07-16) removed the old shared counter's hard cap on total vision-API spend; VISION_DAILY_LIMIT now bounds each user individually, so spend scales with active users
- [ ] User tiers via Firebase Remote Config instead of a DB table (2026-07-16, Ben's call: a `user_limits` DB table + admin page felt like too much machinery for this) — an admin adds/removes emails from a Remote Config parameter (a JSON array, e.g. `admin_tier_emails`) in the Firebase console; the server reads it via firebase-admin's server-side Remote Config SDK (`getRemoteConfig()`/`getServerTemplate()`, Admin SDK v12.1.0+) and evaluates it per-request, so membership changes apply without a restart or redeploy — no client-side Remote Config here, since a quota is exactly the kind of "sensitive control" Firebase's own docs say not to leave to client-evaluated config. Two tiers to start (admins get a higher VISION_DAILY_LIMIT, everyone else gets the default); more tiers later if it's ever needed. Mind Remote Config's fetch/cache interval so console edits don't feel instant-but-actually-lag by a few minutes.

## Developer experience

- [ ] Local Firebase Emulator Suite for dev (2026-07-16) — right now `lib/firebase.ts` and the server's `firebaseVerifier.ts` talk to the real `sleevesnap` Firebase project even when developing locally; there's no `connectAuthEmulator`/`connectFirestoreEmulator` wiring at all. We hit the downside of this directly: had to create a throwaway test account in production Firebase Auth just to verify the signup-validation UI. Firebase's own recommendation is `firebase emulators:start` (Auth on 127.0.0.1:9099, Firestore on 8080, plus an Emulator UI), connected only in dev builds, with `--export-on-exit`/`--import` to keep a seed user + starter collection across restarts instead of recreating one every session. Auth emulator is the concrete near-term win; Firestore emulator is purely exploratory for now since we don't persist anything in Firestore yet (see Firestore note below).
- [ ] Firestore as a data store — exploratory only, not decided. We currently have zero persistence inside Firebase (SQLite via better-sqlite3 handles collection/scan-history/quota); this is just a "how would local dev even look" question raised in passing, not a plan to migrate. If it ever becomes real, it rides on the same Emulator Suite item above.

## Account & user management

- [ ] Show auth provider type (Google/GitHub/email) next to the user's email in the UI
- [ ] User settings/preferences page
- [ ] Delete account request flow
- [ ] Clear collection with confirm

## Legal/trust

- [ ] T&Cs and privacy policy

## Growth & onboarding

- [ ] Improved landing page with a feature demo
- [ ] Demo/guest-mode-with-transfer-on-signup — agreed direction, needs its own design pass (see `ux-improvement-plan.md`'s Firebase Auth update note)
- [ ] Import collection in batch (format/approach still undecided — Discogs CSV import was floated in `ux-improvement-plan.md` §3.5 as one option)

## Social

- [ ] Share collections with other users
- [ ] Public profiles

## Collection & UI polish

- [ ] Let the user pick their own collection cover image (self-taken photo vs. MusicBrainz thumbnail)
- [ ] Basic crop/position adjustment for that image (nothing fancy)
- [ ] Redo the card "size" slider (already flagged in `ux-improvement-plan.md` §3.7 as a known weak control)
- [ ] Detail page for a release and for a release group (ties to `ux-improvement-plan.md` §3.2's planned `/collection/:id` detail view)
- [ ] Discover page needs content when empty (inspiration/history section) instead of a blank landing state
- [ ] Make the "snap" capture animation clearer/more noticeable and let it linger longer
- [ ] "Show releases" may be one click too many for some users — ideas: auto-expand when there's only one release in the group; a quick-add button for a specific release without expanding first

## Branding

- [ ] Add "made by sol3uk" next to the "powered by musicbrainz" credit line (`components/Layout.tsx` — `Logo`/credit block)
- [ ] Standardise and improve the looks of the validation emails the user gets, as well as the landing page after validation, they're currently all very generic
