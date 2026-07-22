# MusicBrainz data model (for sleevesnap contributors)

MusicBrainz's hierarchy trips people up because "an album" is actually several different entities depending on what you're asking about. This doc exists because it tripped us up too — write it down once, stop re-deriving it.

## The hierarchy

```
Artist
  └─ Release Group          "Songs for the Deaf" (the abstract album)
       └─ Release           one specific pressing/edition
            └─ Medium       a disc or side within that pressing
                 └─ Track   a Recording's slot on that medium
                      └─ Recording   the actual audio performance
```

- **Release Group** — the abstract concept of an album, EP, single, etc., independent of any specific pressing. Has a `primary-type` (Album, EP, Single, ...) and optional `secondary-types` (Compilation, Live, Soundtrack, ...). This is what a person means when they say "have you heard *Songs for the Deaf*?"
- **Release** — one specific published edition of a release group: a country, a release date, a format, a catalog number, packaging. The US 2002 CD and the UK 2002 vinyl pressing of the same album are two different Releases under the same Release Group.
- **Medium** — a disc or side within a Release (a 2xLP release has two Media).
- **Track** — a Recording's position on a specific Release's Medium — the join between "this performance" and "this physical/digital product."
- **Recording** — the actual audio: a specific performance/master. The same Recording can appear on multiple Releases (e.g. the same master reused across a reissue).

## Why sleevesnap searches at two different levels

`server/routes/search.ts` has two entry points that intentionally search at different levels of this hierarchy, because they're answering different questions:

- **`POST /api/search/groups`** (Discover Vinyl) searches **Release Groups** directly. The user is browsing "what albums exist by this artist/matching this title" — one row per real album is exactly the right unit, and it's what makes exact, cheap pagination possible (see below).
- **`POST /api/search`** and `searchReleasesByText` (Scanner's manual search box, and validating an AI vision guess) search **Releases** directly. Here the question is "does a specific pressing matching this artist/title exist, and what format/metadata does it have" — you need the concrete Release, not the abstract group, to answer that. This is a single un-batched query with a small limit (`FLAT_SEARCH_LIMIT`), not the timeout-prone code path, so it was left alone in the release-group-primary refactor.

Expanding a Discover result ("Show releases") still needs to go down to the Release level too — `GET /api/search/groups/:releaseGroupId/releases` and `fetchReleasesByGroupId` do exactly that, given an already-known release-group id, and are shared by both the Discover format-filtering logic and the expand UI.

## Why Release-Group search, not scanning Releases

The original implementation of Discover search queried MusicBrainz's **release** endpoint (`/ws/2/release`) and reconstructed release-groups by scanning up to 3000 individual releases in sequential batches, tallying which group each one belonged to. This was slow (routinely timed out) and only ever produced an approximate total.

Confirmed empirically (July 2026): the same query against `/ws/2/release-group` directly returns an **exact** count of matching albums, with a dramatically smaller result set — searching "queens of the stone age" returned `count: 96` release-groups vs. `count: 308` individual releases for the identical query. Release-group search gives true offset-based pagination for free; no scanning, no approximation.

The catch: release-group search results **do not include per-release format/media info**, even when `inc=media` is appended to the request — confirmed by testing directly. Learning a group's available formats/release count requires a follow-up call per release-group (`fetchReleasesByGroupId`), and MusicBrainz allows only ~1 request/sec per IP (see Rate Limiting below) — so calling it eagerly for every one of ~10 search results turns one search into a 10+ second wait. `server/routes/search.ts`'s `searchGroups`/`fetchReleaseGroupPage` therefore return release-groups **unenriched** (title/artist/type/date/cover-art only, no MusicBrainz call beyond the single release-group search itself) — formats and release count are only fetched when a group is deliberately expanded (`GET /api/search/groups/:id/releases`), matching how musicbrainz.org's own release-group listing works: cheap to browse, format detail lives one click deeper.

### Why there's no server- or client-side format filtering on the results list

MusicBrainz is a community-maintained database — its per-release format data can be incomplete or simply not kept up to date with what's actually been pressed. Confirmed example: "Laminated Denim" by King Gizzard & the Lizard Wizard is tagged Digital Media only, but real vinyl pressings exist. This isn't something we can fix upstream, so we adapt: filtering release-groups out of Discover results based on this data would cap our own reliability at MusicBrainz's, silently hiding genuine albums with no way for the user to discover they exist.

`POST /api/search/groups` returns every matching release-group unfiltered — and, since the eager-enrichment removal above, without fetching format data for any of them at all, so there's nothing to filter on at the list level even if we wanted to. There used to be a client-side Format filter (Vinyl/CD/etc. checkboxes) that hid whole release-groups based on their `availableFormats`; it was explicitly a "reduce visual noise" convenience, never meant to physically hide results, so it was removed entirely alongside the eager-fetch it depended on rather than kept working via a slower path. A future version may reintroduce it as a query-level filter (e.g. a `format:` Lucene clause added to the MusicBrainz query itself) so it stays fast. `bucketForFormat`/`groupReleasesByFormatBucket` still group an *already-expanded* group's releases into Vinyl/CD/etc. sections — that's a display-only grouping of data already fetched, not a filter.

## Lucene search field reference

MusicBrainz's search backend is Lucene-based; different endpoints index different fields.

**`/ws/2/release-group` search fields:**

| Field | Meaning |
|---|---|
| `releasegroup` | Release group title (default field if none specified) |
| `release` | Title of a release *within* the group |
| `artist` | Combined credited artist name |
| `artistname` | Individual artist name |
| `arid` | Artist MBID |
| `firstreleasedate` | Earliest release date (`"1980-01-22"`) |
| `primarytype` | Album / Single / EP / etc. |
| `secondarytype` | Compilation / Live / Soundtrack / etc. |
| `rgid` | Release-group MBID |
| `comment` | Disambiguation comment |
| `alias` | Alternative names |
| `tag` | User-assigned tags |

**Used elsewhere in this codebase:** `rgid:<id>` against the **release** endpoint (`fetchReleasesByGroupId`) is how we pull every release belonging to a known release-group. The same `releasegroup:`/`release:`/`artist:` field names are valid on both the release-group and release search endpoints, which is why `buildExactSearchQuery`/`buildFallbackSearchQuery` in `search.ts` didn't need to change at all when the primary search moved from one endpoint to the other — only the target URL and response shape changed.

## A real matching quirk worth knowing

Discovered while debugging a "fuzzy search doesn't work" report: MusicBrainz's search index does **not** prefix/fuzzy-match short trailing query fragments. Empirically, searching for `"...the de"` (2-character trailing term) returned zero relevant results, while `"...the dea"` (3 characters) correctly surfaced "Songs for the Dead" and "Songs for the Deaf". The index appears to need roughly 3+ characters per term before it behaves like a partial/prefix match — below that, a term only matches as a complete literal token. This isn't configurable from our side; it's upstream behavior. Relevant if you're ever tuning `buildFallbackSearchQuery`, `escapeLuceneTerm`, or `normalizeSearchInput`.

## Related work

- `plan-artistSearchPaginationUpgrade.prompt.md` describes a larger future rework (configurable page size 5–25, infinite-scroll load-more, an artist-search mode). The release-group-primary refactor this doc describes is designed as the foundation that plan builds on — `collectDiscoverPage`/`fetchReleaseGroupPage` already take `pageSize` as a plain parameter and use offset+limit (not "page number") as the underlying cursor, so neither needs rework for that future UI change.
