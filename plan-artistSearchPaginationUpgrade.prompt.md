## Plan: Artist Search + Pagination Upgrade

Scope is expanded to include better pagination and estimation for existing search, plus incremental infinite-scroll-style loading and configurable results per load from 5 to 25.

**Background:** `server/routes/search.ts` was refactored (see `musicbrainz-data-model.md`) to search MusicBrainz's release-group endpoint directly instead of scanning individual releases. That refactor is this plan's backend foundation — `collectDiscoverPage`/`fetchFilteredReleaseGroupPage` already take `pageSize` as a plain parameter and paginate via offset+limit rather than discrete "pages," so steps 2, 5, 8, 9, and 11 below need little to no backend rework. Read `musicbrainz-data-model.md` first for the hierarchy and field reference this plan's search-mode/artist-strictness work will build on.

**Steps**

1. Add pagination and estimation contract updates across API/client models.
2. Extend grouped search request to include searchMode, formats, pageSize, and optional artist strictness setting.
3. Extend grouped search response metadata to consistently include total, hasMore, isTotalExact, plus optional estimation diagnostics for UI messaging.
4. Keep release-group card result shape unchanged for both existing search and artist search.
5. Improve backend pagination logic to support page size range 5–25 and preserve paging truthfulness, now that filtering happens via per-candidate release-group format lookups (`fetchReleasesByGroupId`) rather than release-level scanning.
6. Confirm the raw-batch retry-round cap (currently 3, introduced in the release-group-primary refactor — see `musicbrainz-data-model.md`) still gives good filtered-page-fill behavior across the 5–25 page size range; the old "scan budget" concept this step used to reference no longer exists.
7. Keep hasMore authoritative in progressive mode; only mark exact totals when scan completion is truly reached.
8. Replace Prev/Next UI with incremental load-more flow: users scroll, reach bottom, and trigger More results to append the next slice smoothly.
9. Add a results-per-load control in Discover with values 5–25, persist it locally, and restart search from page 1 when changed.
10. Preserve appended results and context until query, filters, mode, or page size changes; dedupe on releaseGroupId while appending as a safety guard.
11. Keep artist-search trajectory aligned: Artist-only toggle remains, artist click still opens separate artist view, and that view uses the same load-more/page-size behavior.
12. Expand test and diagnostics coverage for page-size clamping, append behavior, estimation semantics, and hasMore continuity across loads.

**Relevant files**

- c:/Code/sleevesnap/server/routes/search.ts — page size validation; page-size parameterization of `collectDiscoverPage`/`fetchFilteredReleaseGroupPage`; retry-round-cap tuning; estimation metadata semantics.
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
