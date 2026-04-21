## Plan: Artist Search + Pagination Upgrade

Scope is expanded to include better pagination and estimation for existing search, plus incremental infinite-scroll-style loading and configurable results per load from 5 to 25.

**Steps**

1. Add pagination and estimation contract updates across API/client models.
2. Extend grouped search request to include searchMode, formats, pageSize, and optional artist strictness setting.
3. Extend grouped search response metadata to consistently include total, hasMore, isTotalExact, plus optional estimation diagnostics for UI messaging.
4. Keep release-group card result shape unchanged for both existing search and artist search.
5. Improve backend pagination logic to support page size range 5–25 and preserve filtered-first paging truthfulness.
6. Update scan-budget heuristics to scale with requested page size and depth so larger page sizes do not degrade estimation quality.
7. Keep hasMore authoritative in progressive mode; only mark exact totals when scan completion is truly reached.
8. Replace Prev/Next UI with incremental load-more flow: users scroll, reach bottom, and trigger More results to append the next slice smoothly.
9. Add a results-per-load control in Discover with values 5–25, persist it locally, and restart search from page 1 when changed.
10. Preserve appended results and context until query, filters, mode, or page size changes; dedupe on releaseGroupId while appending as a safety guard.
11. Keep artist-search trajectory aligned: Artist-only toggle remains, artist click still opens separate artist view, and that view uses the same load-more/page-size behavior.
12. Expand test and diagnostics coverage for page-size clamping, append behavior, estimation semantics, and hasMore continuity across loads.

**Relevant files**

- c:/Code/sleevesnap/server/routes/search.ts — page size validation, scan budget scaling, estimation metadata semantics, filtered paging.
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
