# Artist Search + Search Abstraction Plan

## Why this plan exists

The current search implementation is tightly coupled to MusicBrainz request shape, query syntax, and response mapping inside one route module. That coupling makes it harder to:

- Add richer artist/title/year/label searching from AI suggestions.
- Evolve ranking and fallback behavior without touching transport code.
- Swap or augment metadata providers in the future.

This plan defines both:

- How to implement advanced artist-aware search (including indexed/Lucene query syntax).
- Where the seam should be between application search logic and MusicBrainz-specific integration.

## Outcomes

1. Search supports structured inputs (artist, title, year, label, format, country) in addition to plain text.
2. AI suggestions can be plugged directly into indexed query generation.
3. App search logic depends on a provider-agnostic interface, not MusicBrainz endpoint details.
4. Existing behavior remains backward compatible while migrating.

## Non-goals (for this phase)

- Replacing MusicBrainz immediately.
- Building a full query language UI for end users.
- Multi-provider federation in the first increment.

## Seam and abstraction design

### Current pain points

- HTTP transport, query composition, MusicBrainz syntax, result mapping, and pagination behavior are mixed in one route.
- Route handlers know too much about provider internals.

### Target seam

Introduce an application-layer search port and provider adapter.

- Application side (provider-agnostic):
  - Accepts SearchIntent and SearchOptions.
  - Returns canonical domain models used by the UI.
- Provider side (MusicBrainz-specific adapter):
  - Builds provider query syntax.
  - Performs HTTP calls and retries.
  - Maps provider payloads into canonical domain models.

### Proposed interfaces

```ts
// Application intent produced by UI and/or AI.
export interface SearchIntent {
  rawQuery?: string;
  artist?: string;
  title?: string;
  year?: string;
  label?: string;
  format?: string;
  country?: string;
  releaseGroupId?: string;
}

export type SearchMode = 'simple' | 'indexed';

export interface GroupSearchOptions {
  page: number;
  pageSize: number;
  includeFormats: boolean;
  mode: SearchMode;
}

export interface CatalogSearchGateway {
  searchReleaseGroups(intent: SearchIntent, options: GroupSearchOptions): Promise<SearchResultPage>;
  getReleaseGroupReleases(releaseGroupId: string): Promise<SearchGroupReleases>;
  searchReleases(intent: SearchIntent, limit: number, mode: SearchMode): Promise<SearchReleaseResult[]>;
}
```

### Canonical data ownership

Keep these canonical types at app boundary (already close to current models):

- SearchResultPage
- SearchResultGroup
- SearchGroupReleases
- SearchReleaseResult

Adapter maps provider responses into these models.

### Module split

- server/search/application/
  - SearchService.ts (orchestrates ranking/fallback strategy)
  - SearchIntent.ts (intent parsing/normalization)
- server/search/ports/
  - CatalogSearchGateway.ts
- server/search/providers/musicbrainz/
  - MusicBrainzCatalogGateway.ts
  - MusicBrainzQueryBuilder.ts
  - MusicBrainzMapper.ts
  - MusicBrainzClient.ts (HTTP + retry + UA + rate controls)
- server/routes/
  - search.ts becomes thin transport/controller layer

## MusicBrainz indexed query strategy

Use indexed mode to generate Lucene-compatible fielded queries from SearchIntent.

### Primary field mapping (release-group search)

- title -> releasegroup:"..."
- artist -> artist:"..." (or artistname:"..." for strict artist-name matching)
- year -> firstreleasedate:YYYY
- release alias fallback -> release:"..."

### Secondary mapping (release search, when needed)

- label -> label:"..."
- format -> format:vinyl
- country -> country:US style two-letter codes
- year -> date:YYYY

### Query policy

1. High-confidence AI fields become stronger constraints.
2. Lower-confidence fields become optional/broader terms.
3. Label stays soft by default to avoid false exclusion (label/title confusion cases).
4. Escape all Lucene special characters before composing field expressions.
5. Build multiple variants (strict -> balanced -> broad) and merge ranked results.

## Ranking and fallback behavior

### Variant execution order

1. strict indexed query (artist + title, optional year)
2. balanced indexed query (artist OR title with selected constraints)
3. broad indexed query (phrase and token fallback)
4. plain/simple fallback (existing behavior)

### Merge strategy

- Deduplicate by releaseGroupId (or MBID fallback).
- Score by:
  - variant priority
  - exact title match
  - artist match quality
  - year proximity
- Return stable sorted results to UI.

## API contract evolution

### Backward-compatible request shape

Current clients sending query continue to work.

Add optional advanced payload:

```json
{
  "query": "songs for the deaf",
  "mode": "indexed",
  "intent": {
    "artist": "Queens of the Stone Age",
    "title": "Songs for the Deaf",
    "year": "2002",
    "label": "Interscope"
  },
  "page": 1,
  "pageSize": 5
}
```

Server behavior:

- if intent exists -> build structured query flow.
- else -> current plain query flow.

## AI integration path

1. Normalize AI suggestions into SearchIntent.
2. Generate indexed query variants from intent.
3. Surface applied constraints in logs and (later) UI chips.
4. Allow user edits/removal of constraints before rerun.

## Testing plan

### Unit tests

- MusicBrainzQueryBuilder
  - field mapping
  - escaping
  - variant generation
  - confidence-aware inclusion rules
- SearchService
  - merge and ranking
  - fallback order

### Integration tests

- route -> application service -> gateway path
- indexed mode queries hit provider with expected query strings
- plain mode remains unchanged
- regression fixture: top AI guess wrong, second guess correct

### Contract tests

- provider adapter mapping from MusicBrainz payload to canonical models
- ensure model changes do not leak provider-specific shape into app layer

## Observability

Log structured events:

- search.mode
- search.intent.fields_used
- search.query_variants_executed
- search.variant_hit_counts
- search.result_merge_stats
- provider latency + status by endpoint

## Rollout plan

### Phase 1: carve seam without behavior change

- Extract MusicBrainz client, mapper, and gateway.
- Keep current logic paths, only move responsibilities.
- Route becomes thin controller.

### Phase 2: add SearchIntent and indexed mode behind flag

- Add mode=intent support in route payload.
- Keep default mode=simple.

### Phase 3: implement query builder + variant fallback

- Enable indexed mode for scanner AI-seeded searches first.
- Keep discover manual search on simple mode initially.

### Phase 4: expand manual discover search

- Add optional advanced setting/toggle.
- Add applied-constraint chips in UI.

### Phase 5: tune ranking and constraints

- Use logs to tune strictness and variant ordering.
- Add provider-agnostic relevance scoring tests.

## Risks and mitigations

- Risk: over-constrained indexed queries reduce recall.
  - Mitigation: variant fallback chain and soft constraints.
- Risk: Lucene escaping bugs produce empty/bad results.
  - Mitigation: dedicated escaping tests and fuzz inputs.
- Risk: route/controller regressions during extraction.
  - Mitigation: snapshot current route integration tests before refactor.
- Risk: provider lock-in remains if adapter leaks provider shape.
  - Mitigation: enforce canonical return models at port boundary.

## Definition of done

1. Search route no longer directly composes MusicBrainz-specific query syntax.
2. All provider access is behind CatalogSearchGateway.
3. Indexed mode supports artist/title/year/label intent inputs.
4. AI suggestion flow can pass structured intent directly.
5. Existing simple query behavior remains available and tested.
