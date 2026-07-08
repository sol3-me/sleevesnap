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

The catch: release-group search results **do not include per-release format/media info**, even when `inc=media` is appended to the request — confirmed by testing directly. So Discover still needs a follow-up call per candidate release-group (reusing `fetchReleasesByGroupId`, the same lookup "Show releases" already uses) to learn its available formats. `server/routes/search.ts`'s `collectDiscoverPage`/`fetchReleaseGroupPage` fetch one release-group page at a time and enrich every candidate in it via `enrichCandidate` — cheap compared to the old release-scanning approach because it's a handful of parallel lookups per page, not a sequential scan, and (see below) nothing is ever dropped, so there's no retry/exhaustion logic needed either.

### Why Vinyl/CD filtering is client-side, not server-side

MusicBrainz is a community-maintained database — its per-release format data can be incomplete or simply not kept up to date with what's actually been pressed. Confirmed example: "Laminated Denim" by King Gizzard & the Lizard Wizard is tagged Digital Media only, but real vinyl pressings exist. This isn't something we can fix upstream, so we adapt: filtering release-groups out of Discover results based on this data would cap our own reliability at MusicBrainz's, silently hiding genuine albums with no way for the user to discover they exist.

`POST /api/search/groups` returns every matching release-group unfiltered, enriched with its real `availableFormats` — pulling as much real signal out of the MusicBrainz API as possible, including the literal value `'Unknown'` when a release has no format data at all (mirroring how MusicBrainz's own site represents this). The format checkboxes in `App.tsx` are a pure client-side display filter (`filteredGroups`/`bucketsForGroup`), applied after the fetch, with no re-fetch when toggled. Checkboxes are generated dynamically from whatever real format buckets are present in the current results (Vinyl, CD, Digital Media, Unknown, ...) rather than hardcoded to two options — `bucketForFormat` groups obvious variants under one label (anything containing "Vinyl" or "CD") but otherwise shows MusicBrainz's raw format string as-is.

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
