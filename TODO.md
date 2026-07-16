# sleevesnap TODO

Ben's running backlog of next-up ideas — not prioritized or ordered, just captured so nothing gets lost between sessions. For implemented/in-progress work with more design detail, see `project-roadmap.md` and `ux-improvement-plan.md`.

_Captured 2026-07-16, right after Firebase Authentication merged to main._

## Observability

- [ ] Telemetry for which accounts are using AI vision tokens (cost/usage attribution per user, ties into the shared daily vision quota)
- [ ] General custom-event telemetry: scans (success/fail), MusicBrainz timeouts/errors, etc. — `services/telemetry.ts` today is just a `console.log` shim (mirrors `server/logger.ts`'s bracket-tag style), not a real event pipeline, so this is new infra, not an upgrade
- [ ] Uptime alerts + health checks (Ben mentioned "pangolin?" as a possible tool to look into)
- [ ] Show the site's release/version number somewhere

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
