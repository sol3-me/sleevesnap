## Plan: Artist Search + Pagination Upgrade

Scope is expanded to include better pagination and estimation for existing search, plus incremental infinite-scroll-style loading and configurable results per load from 5 to 25.

**Background:** `server/routes/search.ts` was refactored (see `musicbrainz-data-model.md`) to search MusicBrainz's release-group endpoint directly instead of scanning individual releases. That refactor is this plan's backend foundation — `collectDiscoverPage`/`fetchReleaseGroupPage` already take `pageSize` as a plain parameter and paginate via offset+limit rather than discrete "pages," so steps 2, 5, 8, 9, and 11 below need little to no backend rework. A further pivot moved Vinyl/CD/etc. filtering entirely client-side (also documented in `musicbrainz-data-model.md`): `/api/search/groups` now returns every matching release-group unfiltered, enriched with its real formats, and `isTotalExact` is unconditionally `true` since nothing is ever dropped — a stronger, simpler foundation for this plan's estimation/diagnostics work than the old approximate-total path. Read `musicbrainz-data-model.md` first for the hierarchy, field reference, and format-filtering rationale this plan's search-mode/artist-strictness work will build on.

**Steps**

1. Add pagination and estimation contract updates across API/client models.
2. Extend grouped search request to include searchMode, pageSize, and optional artist strictness setting. (Format filtering is client-side and plays no part in the request — see `musicbrainz-data-model.md`.)
3. Extend grouped search response metadata to consistently include total, hasMore, isTotalExact, plus optional estimation diagnostics for UI messaging.
4. Keep release-group card result shape unchanged for both existing search and artist search.
5. Improve backend pagination logic to support page size range 5–25 and preserve paging truthfulness, now that every candidate release-group is enriched with its real formats via `enrichCandidate`/`fetchReleasesByGroupId` rather than being filtered/dropped.
6. N/A — the raw-batch retry-round cap no longer exists at all (not just re-tuned). Discover search now fetches and enriches every candidate in a single raw batch per page with no retry/exhaustion logic, since results are never dropped server-side (see `musicbrainz-data-model.md`).
7. Keep hasMore authoritative in progressive mode; only mark exact totals when scan completion is truly reached.
8. Replace Prev/Next UI with incremental load-more flow: users scroll, reach bottom, and trigger More results to append the next slice smoothly.
9. Add a results-per-load control in Discover with values 5–25, persist it locally, and restart search from page 1 when changed.
10. Preserve appended results and context until query, filters, mode, or page size changes; dedupe on releaseGroupId while appending as a safety guard.
11. Keep artist-search trajectory aligned: Artist-only toggle remains, artist click still opens separate artist view, and that view uses the same load-more/page-size behavior.
12. Expand test and diagnostics coverage for page-size clamping, append behavior, estimation semantics, and hasMore continuity across loads.

**Relevant files**

- c:/Code/sleevesnap/server/routes/search.ts — page size validation; page-size parameterization of `collectDiscoverPage`/`fetchReleaseGroupPage`; estimation metadata semantics.
- c:/Code/sleevesnap/server/routes/search.test.ts — regression tests for 5–25 page size range and progressive estimation behavior.
- c:/Code/sleevesnap/server/scripts/debugSearchPagination.ts — diagnostics for mode, formats, page size, and metadata progression.
- c:/Code/sleevesnap/types.ts — request/response model updates for pagination and estimation.
- c:/Code/sleevesnap/services/vinylService.ts — payload/cache-key dimensions including page size and mode.
- c:/Code/sleevesnap/App.tsx — load-more UX, append state, page-size control/persistence, smooth loading behavior, reset rules.

**Verification**

1. Run search route tests and ensure page-size and estimation cases pass.
2. Run full build to validate frontend and backend compile.
3. Run diagnostics for representative queries at page sizes 5, 10, and 25.
4. Manually verify:
5. More results appends smoothly with no jarring reset.
6. Results-per-load persists and re-applies on reload.
7. Query/filter/mode/page-size changes correctly reset to a clean page 1.
8. No duplicate groups appear after multiple load-more actions.
9. Count messaging remains truthful in exact vs progressive cases.

**Decisions included in this scope**

1. Infinite-scroll style is implemented as explicit bottom More results trigger.
2. User-configurable results per load range is fixed to minimum 5 and maximum 25.
3. Existing search estimation is upgraded, not replaced, and remains truthful via hasMore/isTotalExact semantics.

---

## Plan Extension: Entity-First Artist/Label Search

Goal: when search type is Artist or Label, do not search albums directly from free text. First return actual MusicBrainz artist/label entities, let the user select one, then run album search constrained to that exact selected entity.

### Why this is needed

1. Name collisions are common (same artist/label name, different entities).
2. Lucene text matching alone is ambiguous and leads to wrong catalog results.
3. MBIDs provide deterministic filtering once an entity is chosen.

### UX flow

1. User chooses search type Artist or Label.
2. User types query and clicks Search.
3. UI shows entity picker list instead of release-groups:
4. Artist picker rows: name, disambiguation, country/area, life-span.
5. Label picker rows: name, disambiguation, label code, country/area, type.
6. User selects one entity.
7. UI runs release-group search constrained by selected MBID.
8. Results header shows active chip, e.g. Artist: Queen (GB).
9. Clear chip returns user to entity-picker stage for that query.

### API additions

1. POST /api/search/artists
2. Request: { query, page, pageSize }
3. Response: { query, page, pageSize, total, hasMore, entities: ArtistSearchEntity[] }
4. POST /api/search/labels
5. Request: { query, page, pageSize }
6. Response: { query, page, pageSize, total, hasMore, entities: LabelSearchEntity[] }
7. Extend POST /api/search/groups intent:
8. intent.artistId?: string
9. intent.labelId?: string

### Backend behavior

1. Artist endpoint queries MusicBrainz artist search and maps stable fields for disambiguation.
2. Label endpoint queries MusicBrainz label search and maps stable fields for disambiguation.
3. Group search builder prefers IDs over names when provided:
4. artist:<mbid> (or arid:<mbid> if supported by endpoint semantics)
5. label:<mbid> (or laid:<mbid> equivalent)
6. If only name is present, keep current fielded fallback behavior.
7. Keep existing format/type filtering model unchanged for now.

### Frontend state model

1. Add entity-selection mode in Discover state machine:
2. idle -> pickingEntity -> showingGroups
3. URL params additions:
4. aid (selected artist MBID)
5. an (selected artist display name)
6. lid (selected label MBID)
7. ln (selected label display name)
8. Cache keys include selected entity IDs.

### Testing plan

1. Route tests for /api/search/artists and /api/search/labels mapping + pagination.
2. Route tests proving /api/search/groups builds ID-constrained queries when aid/lid present.
3. Frontend service tests for new endpoints and cache key separation by MBID.
4. Discover UI tests for picker -> select -> constrained group search flow.

### Rollout sequence

1. Add new types/contracts in types.ts.
2. Implement backend artist/label entity routes.
3. Wire client service methods for entity lookup.
4. Add Discover entity picker UI and selected-entity chips.
5. Wire constrained album search with selected MBID.
6. Validate manually with collision-prone names (for example Queen, London Records).

---

## Plan Extension: Artist and Label Detail Pages

Goal: enable direct navigation to internal Artist/Label summary pages (Spotify-like discovery flow), powered by MusicBrainz data and connected to Discover search context.

### UX goals

1. Users can click through from Discover to a dedicated artist or label page.
2. Detail pages show canonical identity and a browsable release-group list.
3. Navigation preserves context (selected artist/label, page, query) and supports deep links.

### Initial slice (start phase)

1. Add routes:
2. /artists/$artistId
3. /labels/$labelId
4. Pass display name in search params (name) for immediate header rendering.
5. Populate release-groups using indexed MBID-constrained search (artistId/labelId).
6. Use detail-page infinite scroll (detail pages only) with 20 release-groups per batch.

### Next iterations

1. Add richer artist metadata endpoint by MBID (area, begin/end, tags, aliases).
2. Add richer label metadata endpoint by MBID (country, type, label code, parent relationships).
3. Add sections/tabs:
4. Albums vs singles/EPs vs other primary types.
5. Year sorting and quick filters.
6. Click-through from release cards to album/release-group details.

### Discover integration

1. Selected-entity chip includes link to the corresponding detail page.
2. Artist names in result cards can trigger artist-focused discovery flow.
3. Label-focused searches can open label detail page after entity selection.

### Verification

1. Route navigation works with direct URL entry.
2. Artist/label pages show release groups for the selected MBID.
3. Infinite scroll loads additional 20-item batches on detail pages as users approach the bottom.
4. Manual browser check confirms click paths from Discover to detail views.
