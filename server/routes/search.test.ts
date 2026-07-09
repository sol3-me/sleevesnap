import express from 'express';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { searchReleasesByText, searchRouter } from './search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Real /ws/2/release-group search responses for "queens of the stone age",
// captured live at offset 0/5/10 (limit=5 each), plus a consolidated map of
// real /ws/2/release?query=rgid:X responses (format info) for every
// candidate release-group id appearing across those three pages. Several of
// these candidates are digital-only tribute/parody releases with no vinyl or
// CD edition — real MusicBrainz data used to prove that Discover search
// returns every candidate unfiltered, each enriched with its real formats,
// rather than dropping the ones that don't have a physical release.
function loadRgFixture(name: string) {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf-8'));
}

const rgPage1 = loadRgFixture('release-group-search-qotsa-page1-real.json');
const rgPage2 = loadRgFixture('release-group-search-qotsa-page2-real.json');
const rgPage3 = loadRgFixture('release-group-search-qotsa-page3-real.json');
const rgReleasesById = loadRgFixture('release-group-releases-by-id-qotsa-real.json') as Record<string, unknown>;

// Real "Laminated Denim" case: exactly 1 release-group matches (both the
// exact-phrase and fallback AND-of-terms queries return the same single
// group), and its only 2 releases are both Digital Media — no vinyl or CD
// release exists for this album at all. This is the real report that started
// the client-side-filtering pivot: MusicBrainz's format data is incomplete
// (the user owns an actual vinyl pressing of this album), so Discover search
// must surface the release-group regardless, enriched with whatever real
// format data MusicBrainz does have, rather than silently hiding it.
const laminatedDenimExact = loadRgFixture('release-group-search-laminated-denim-real.json');
const laminatedDenimFallback = loadRgFixture('release-group-search-laminated-denim-fallback-real.json');
const laminatedDenimReleases = loadRgFixture('release-releases-by-group-laminated-denim-real.json');

/** Mocks both /ws/2/release-group (paged by offset, from the three real page fixtures) and /ws/2/release?query=rgid:X (from the consolidated real releases-by-id fixture). */
function mockReleaseGroupEndpoints(): typeof fetch {
    return (async (input) => {
        const target =
            typeof input === 'string'
                ? input
                : input instanceof URL
                    ? input.toString()
                    : input.url;
        const url = new URL(target);

        if (url.pathname === '/ws/2/release-group') {
            const offset = url.searchParams.get('offset');
            if (offset === '0') return jsonResponse(rgPage1);
            if (offset === '5') return jsonResponse(rgPage2);
            if (offset === '10') return jsonResponse(rgPage3);
            return jsonResponse({ count: rgPage1.count, offset: Number(offset), 'release-groups': [] });
        }

        if (url.pathname === '/ws/2/release') {
            const rgidParam = url.searchParams.get('query') ?? '';
            const match = /rgid:(\S+)/.exec(rgidParam);
            const rgid = match?.[1];
            if (rgid && rgReleasesById[rgid]) {
                return jsonResponse(rgReleasesById[rgid]);
            }
            return jsonResponse({ releases: [] });
        }

        if (url.pathname.startsWith('/ws/2/release-group/')) {
            return jsonResponse({ relations: [] });
        }

        return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            'content-type': 'application/json',
        },
    });
}

async function startTestServer(): Promise<{ server: http.Server; port: number }> {
    const app = express();
    app.use(express.json());
    app.use('/api/search', searchRouter);

    return await new Promise((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                throw new Error('Expected an ephemeral TCP port');
            }
            resolve({ server, port: address.port });
        });
    });
}

async function closeServer(server: http.Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close((err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}

async function requestJson(
    port: number,
    path: string,
    method: 'GET' | 'POST' = 'GET',
    body?: unknown,
): Promise<{ statusCode: number; json: any }> {
    return await new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : undefined;

        const req = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path,
                method,
                headers: payload
                    ? {
                        'content-type': 'application/json',
                        'content-length': Buffer.byteLength(payload),
                    }
                    : undefined,
            },
            (res) => {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    const json = data ? (JSON.parse(data) as unknown) : undefined;
                    resolve({ statusCode: res.statusCode ?? 0, json });
                });
            },
        );

        req.on('error', reject);

        if (payload) {
            req.write(payload);
        }

        req.end();
    });
}

test('GET group releases requests media and returns discogs master when available', async () => {
    globalThis.fetch = (async (input) => {
        const target =
            typeof input === 'string'
                ? input
                : input instanceof URL
                    ? input.toString()
                    : input.url;
        const url = new URL(target);

        if (url.pathname === '/ws/2/release') {
            assert.equal(url.searchParams.get('query'), 'rgid:test-group');
            assert.equal(url.searchParams.get('inc'), 'media');
            return jsonResponse({
                releases: [
                    {
                        id: 'release-1',
                        title: 'Rated R',
                        date: '2000-06-06',
                        media: [{ format: '12" Vinyl' }],
                        'artist-credit': [{ artist: { name: 'Queens of the Stone Age' } }],
                        'release-group': {
                            id: 'test-group',
                            title: 'Rated R',
                            'primary-type': 'Album',
                        },
                    },
                ],
            });
        }

        if (url.pathname === '/ws/2/release-group/test-group') {
            assert.equal(url.searchParams.get('inc'), 'url-rels');
            return jsonResponse({
                relations: [{ type: 'discogs', url: { resource: 'https://www.discogs.com/master/22222' } }],
            });
        }

        return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const { server, port } = await startTestServer();

    try {
        const res = await requestJson(port, '/api/search/groups/test-group/releases');
        assert.equal(res.statusCode, 200);
        assert.equal(res.json.releaseGroupId, 'test-group');
        assert.equal(res.json.discogsMasterUrl, 'https://www.discogs.com/master/22222');
        assert.deepEqual(res.json.availableFormats, ['12" Vinyl']);
        assert.equal(res.json.releases[0].format, '12" Vinyl');
    } finally {
        await closeServer(server);
    }
});

test('GET group releases omits discogs master when only non-master discogs relation exists', async () => {
    globalThis.fetch = (async (input) => {
        const target =
            typeof input === 'string'
                ? input
                : input instanceof URL
                    ? input.toString()
                    : input.url;
        const url = new URL(target);

        if (url.pathname === '/ws/2/release') {
            return jsonResponse({
                releases: [
                    {
                        id: 'release-2',
                        title: 'Rated R',
                        media: [{ format: 'CD' }],
                        'artist-credit': [{ artist: { name: 'Rihanna' } }],
                        'release-group': { id: 'test-group-2', title: 'Rated R' },
                    },
                ],
            });
        }

        if (url.pathname === '/ws/2/release-group/test-group-2') {
            return jsonResponse({
                relations: [{ type: 'discogs', url: { resource: 'https://www.discogs.com/release/123456' } }],
            });
        }

        return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const { server, port } = await startTestServer();

    try {
        const res = await requestJson(port, '/api/search/groups/test-group-2/releases');
        assert.equal(res.statusCode, 200);
        assert.equal(Object.prototype.hasOwnProperty.call(res.json, 'discogsMasterUrl'), false);
    } finally {
        await closeServer(server);
    }
});

test('POST /api/search asks MusicBrainz for media and defaults to vinyl-only filtering', async () => {
    globalThis.fetch = (async (input) => {
        const target =
            typeof input === 'string'
                ? input
                : input instanceof URL
                    ? input.toString()
                    : input.url;
        const url = new URL(target);

        if (url.pathname === '/ws/2/release') {
            assert.equal(url.searchParams.get('inc'), 'media');
            return jsonResponse({
                releases: [
                    {
                        id: 'release-vinyl',
                        title: 'Rated R',
                        media: [{ format: '12" Vinyl' }],
                        'artist-credit': [{ artist: { name: 'Queens of the Stone Age' } }],
                    },
                    {
                        id: 'release-cd',
                        title: 'Rated R',
                        media: [{ format: 'CD' }],
                        'artist-credit': [{ artist: { name: 'Rihanna' } }],
                    },
                ],
            });
        }

        return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const { server, port } = await startTestServer();

    try {
        const res = await requestJson(port, '/api/search', 'POST', { query: 'Rated R' });
        assert.equal(res.statusCode, 200);
        assert.equal(Array.isArray(res.json), true);
        assert.equal(res.json.length, 1);
        assert.equal(res.json[0].musicBrainzId, 'release-vinyl');
    } finally {
        await closeServer(server);
    }
});

test('POST /api/search/groups queries the release-group endpoint directly with the exact Lucene query and type=album', async () => {
    let capturedUrl: URL | undefined;
    globalThis.fetch = (async (input) => {
        const target =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(target);
        if (url.pathname === '/ws/2/release-group') {
            // Nothing is filtered anymore, so a single matching candidate
            // (count: 1) never needs a follow-up fallback call — this is the
            // only call to /ws/2/release-group this test expects.
            capturedUrl = url;
            return jsonResponse({
                count: 1, 'release-groups': [
                    {
                        id: 'g1',
                        title: 'Rated R',
                        'first-release-date': '2000-01-01',
                        'primary-type': 'Album',
                        'artist-credit': [{ artist: { name: 'Queens of the Stone Age' } }],
                    },
                ]
            });
        }
        if (url.pathname === '/ws/2/release') {
            return jsonResponse({
                releases: [
                    {
                        id: 'r1',
                        title: 'Rated R',
                        media: [{ format: '12" Vinyl' }],
                        'artist-credit': [{ artist: { name: 'Queens of the Stone Age' } }],
                        'release-group': { id: 'g1', title: 'Rated R' },
                    },
                ],
            });
        }
        if (url.pathname.startsWith('/ws/2/release-group/')) {
            return jsonResponse({ relations: [] });
        }
        return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const { server, port } = await startTestServer();

    try {
        await requestJson(port, '/api/search/groups', 'POST', {
            query: 'Rated R',
            page: 1,
            pageSize: 5,
        });

        assert.ok(capturedUrl, 'expected a call to /ws/2/release-group');
        assert.equal(capturedUrl!.searchParams.get('type'), 'album');
        assert.equal(capturedUrl!.searchParams.get('limit'), '5');
        assert.equal(capturedUrl!.searchParams.get('offset'), '0');
        assert.equal(
            capturedUrl!.searchParams.get('query'),
            '(releasegroup:"Rated R" OR release:"Rated R" OR artist:"Rated R")',
        );
    } finally {
        await closeServer(server);
    }
});

test('POST /api/search/groups normalizes punctuation-heavy free-text input before building Lucene query', async () => {
    let capturedUrl: URL | undefined;

    globalThis.fetch = (async (input) => {
        const target =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(target);

        if (url.pathname === '/ws/2/release-group') {
            capturedUrl = url;
            return jsonResponse({ count: 0, 'release-groups': [] });
        }

        return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const { server, port } = await startTestServer();

    try {
        const res = await requestJson(port, '/api/search/groups', 'POST', {
            query: 'Queens of the Stone Age - Songs for the Deaf (2002)',
            page: 1,
            pageSize: 5,
        });

        assert.equal(res.statusCode, 200);
        assert.ok(capturedUrl, 'expected a call to /ws/2/release-group');
        const builtQuery = capturedUrl!.searchParams.get('query') ?? '';
        assert.equal(builtQuery.includes('(2002)'), false);
        assert.equal(builtQuery.includes('Queens'), true);
        assert.equal(builtQuery.includes('Songs'), true);
        assert.equal(builtQuery.includes('Deaf'), true);
        assert.equal(builtQuery.includes('2002'), true);
        assert.equal(builtQuery.includes('Stone Age - Songs'), false);
    } finally {
        await closeServer(server);
    }
});

test('POST /api/search/groups returns every raw candidate from the batch, unfiltered, each enriched with its real (unfiltered) formats (real data)', async () => {
    let releaseGroupSearchCalls = 0;
    const baseFetch = mockReleaseGroupEndpoints();
    globalThis.fetch = (async (input, init) => {
        const target =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (new URL(target).pathname === '/ws/2/release-group') releaseGroupSearchCalls += 1;
        return baseFetch(input, init);
    }) as typeof fetch;

    const { server, port } = await startTestServer();

    try {
        const res = await requestJson(port, '/api/search/groups', 'POST', {
            query: 'queens of the stone age',
            page: 1,
            pageSize: 5,
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.json.total, 96);
        assert.equal(res.json.isTotalExact, true);
        assert.equal(res.json.hasMore, true);
        // Exactly one raw batch is fetched — no retry rounds are needed
        // anymore since nothing gets filtered out and re-fetched to top up.
        assert.equal(releaseGroupSearchCalls, 1);

        const byId = new Map(
            res.json.groups.map((g: { releaseGroupId: string }) => [g.releaseGroupId, g]),
        );
        assert.deepEqual([...byId.keys()], [
            '17ee0d7f-4a9d-317f-a0b0-8ca528a34b19', // Queens of the Stone Age
            '351ed669-d97b-4b2e-80c2-e9c504992c13', // Kyuss / Queens of the Stone Age
            '95335849-2536-344f-acb6-0424c7d56411', // Queens of the Stone Age / Beaver
            '1893cf55-0a80-4465-890b-6da7db246f0e', // Uncovered Queens of the Stone Age
            'd6657084-d471-3b6a-9b6d-17621da96cdb', // Lullaby Renditions of Queens of the Stone Age
        ]);

        // totalReleases now counts every release in the group (was a
        // format-filtered count before) and availableFormats reports every
        // real format found, including ones that don't match any particular
        // checkbox — e.g. "Digital Media" here, which the old server-side
        // filter would have silently dropped from the set.
        const qotsa = byId.get('17ee0d7f-4a9d-317f-a0b0-8ca528a34b19') as {
            totalReleases: number;
            availableFormats: string[];
        };
        assert.equal(qotsa.totalReleases, 17);
        assert.deepEqual(qotsa.availableFormats, ['CD', '12" Vinyl', 'Digital Media']);

        const kyuss = byId.get('351ed669-d97b-4b2e-80c2-e9c504992c13') as {
            totalReleases: number;
            availableFormats: string[];
        };
        assert.equal(kyuss.totalReleases, 2);
        assert.deepEqual(kyuss.availableFormats, ['CD']);
    } finally {
        await closeServer(server);
    }
});

test('POST /api/search/groups surfaces MusicBrainz\'s primary-type (Album/Single/EP) so same-titled groups can be told apart (real data)', async () => {
    // Real report: searching "Will of the People" returns two separate
    // MusicBrainz release-groups both by Muse with the identical title — one
    // is a Single (a pre-release teaser, digital-only) and one is the actual
    // Album (with vinyl/CD editions). Our own type=album query param doesn't
    // reliably filter these apart (confirmed directly against the live API:
    // it still returns Single- and EP-type groups), so the UI needs the raw
    // primary-type surfaced to distinguish them instead of silently treating
    // every result as if it were the same kind of thing.
    globalThis.fetch = mockReleaseGroupEndpoints();

    const { server, port } = await startTestServer();

    try {
        const res = await requestJson(port, '/api/search/groups', 'POST', {
            query: 'queens of the stone age',
            page: 1,
            pageSize: 5,
        });

        assert.equal(res.statusCode, 200);
        const byId = new Map(
            res.json.groups.map((g: { releaseGroupId: string }) => [g.releaseGroupId, g]),
        );

        assert.equal(
            (byId.get('17ee0d7f-4a9d-317f-a0b0-8ca528a34b19') as { primaryType?: string }).primaryType,
            'Album',
        );
        assert.equal(
            (byId.get('351ed669-d97b-4b2e-80c2-e9c504992c13') as { primaryType?: string }).primaryType,
            'EP',
        );
    } finally {
        await closeServer(server);
    }
});

test('POST /api/search/groups switches to the fallback query at the correct disjoint offset once the exact query is exhausted', async () => {
    const requestedOffsets: number[] = [];
    globalThis.fetch = (async (input) => {
        const target =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(target);

        if (url.pathname === '/ws/2/release-group') {
            const query = url.searchParams.get('query') ?? '';
            const offset = Number(url.searchParams.get('offset'));
            const isExactQuery = query.includes('"tiny rare album"');
            requestedOffsets.push(offset);

            if (isExactQuery) {
                // The exact phrase only ever matches 3 release-groups, total.
                if (offset >= 3) return jsonResponse({ count: 3, offset, 'release-groups': [] });
                return jsonResponse({
                    count: 3,
                    offset,
                    'release-groups': [
                        { id: `exact-${offset}`, title: 'Tiny Rare Album', 'artist-credit': [{ artist: { name: 'X' } }] },
                    ],
                });
            }

            // Fallback (term-AND) query has plenty of results.
            return jsonResponse({
                count: 50,
                offset,
                'release-groups': [
                    { id: `fallback-${offset}`, title: 'Tiny Rare Album (Fallback)', 'artist-credit': [{ artist: { name: 'X' } }] },
                ],
            });
        }

        if (url.pathname === '/ws/2/release') {
            return jsonResponse({
                releases: [
                    {
                        id: 'r1',
                        title: 'Tiny Rare Album',
                        media: [{ format: '12" Vinyl' }],
                        'artist-credit': [{ artist: { name: 'X' } }],
                        'release-group': { id: 'ignored' },
                    },
                ],
            });
        }

        if (url.pathname.startsWith('/ws/2/release-group/')) {
            return jsonResponse({ relations: [] });
        }

        return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const { server, port } = await startTestServer();

    try {
        // Page 2 at pageSize 5 requests offset 5, which is already past the
        // exact query's total of 3 — the fallback query should be queried at
        // offset (5 - 3) = 2, not offset 5.
        const res = await requestJson(port, '/api/search/groups', 'POST', {
            query: 'tiny rare album',
            page: 2,
            pageSize: 5,
        });

        assert.equal(res.statusCode, 200);
        assert.ok(
            requestedOffsets.includes(2),
            `expected a fallback request at offset 2, got offsets: ${requestedOffsets.join(', ')}`,
        );
    } finally {
        await closeServer(server);
    }
});

test('POST /api/search/groups returns Laminated Denim even though MusicBrainz has no vinyl/CD release for it — formats are enriched, never used to hide results (real data)', async () => {
    globalThis.fetch = (async (input) => {
        const target =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(target);

        if (url.pathname === '/ws/2/release-group') {
            const query = url.searchParams.get('query') ?? '';
            const isExactQuery = query.includes('"Laminated Denim"');
            return jsonResponse(isExactQuery ? laminatedDenimExact : laminatedDenimFallback);
        }

        if (url.pathname === '/ws/2/release') {
            return jsonResponse(laminatedDenimReleases);
        }

        if (url.pathname.startsWith('/ws/2/release-group/')) {
            return jsonResponse({ relations: [] });
        }

        return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const { server, port } = await startTestServer();

    try {
        const res = await requestJson(port, '/api/search/groups', 'POST', {
            query: 'Laminated Denim',
            page: 1,
            pageSize: 5,
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.json.total, 1);
        assert.equal(res.json.isTotalExact, true);
        assert.equal(res.json.hasMore, false);
        assert.equal(res.json.groups.length, 1);
        assert.equal(res.json.groups[0].releaseGroupId, '5e2fb12b-ab85-4fe7-be3c-48687f104502');
        assert.deepEqual(res.json.groups[0].availableFormats, ['Digital Media']);
        assert.equal(res.json.groups[0].totalReleases, 2);
    } finally {
        await closeServer(server);
    }
});

test('searchReleasesByText filters to vinyl formats only, matching POST / behaviour', async () => {
    globalThis.fetch = (async (input) => {
        const target =
            typeof input === 'string'
                ? input
                : input instanceof URL
                    ? input.toString()
                    : input.url;
        const url = new URL(target);

        if (url.pathname === '/ws/2/release') {
            return jsonResponse({
                releases: [
                    {
                        id: 'release-vinyl',
                        title: 'Rated R',
                        date: '2000-06-06',
                        media: [{ format: '12" Vinyl' }],
                        'artist-credit': [{ artist: { name: 'Queens of the Stone Age' } }],
                        'release-group': { id: 'group-1', title: 'Rated R', 'primary-type': 'Album' },
                    },
                    {
                        id: 'release-cd',
                        title: 'Rated R',
                        date: '2000-06-06',
                        media: [{ format: 'CD' }],
                        'artist-credit': [{ artist: { name: 'Queens of the Stone Age' } }],
                        'release-group': { id: 'group-1', title: 'Rated R', 'primary-type': 'Album' },
                    },
                ],
            });
        }

        return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const results = await searchReleasesByText('Rated R', 'sleevesnap-test', 15);

    assert.equal(results.length, 1);
    assert.equal(results[0]?.musicBrainzId, 'release-vinyl');
});

test('POST /api/search/groups accepts indexed intent payload and builds a fielded query without a plain query string', async () => {
    let capturedUrl: URL | undefined;
    globalThis.fetch = (async (input) => {
        const target =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(target);

        if (url.pathname === '/ws/2/release-group') {
            capturedUrl = url;
            return jsonResponse({
                count: 1,
                'release-groups': [
                    {
                        id: 'g-intent-1',
                        title: 'Songs for the Deaf',
                        'first-release-date': '2002-08-27',
                        'primary-type': 'Album',
                        'artist-credit': [{ artist: { name: 'Queens of the Stone Age' } }],
                    },
                ],
            });
        }

        if (url.pathname === '/ws/2/release') {
            return jsonResponse({
                releases: [
                    {
                        id: 'r-intent-1',
                        title: 'Songs for the Deaf',
                        media: [{ format: '12" Vinyl' }],
                        'artist-credit': [{ artist: { name: 'Queens of the Stone Age' } }],
                        'release-group': { id: 'g-intent-1', title: 'Songs for the Deaf' },
                    },
                ],
            });
        }

        if (url.pathname.startsWith('/ws/2/release-group/')) {
            return jsonResponse({ relations: [] });
        }

        return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const { server, port } = await startTestServer();

    try {
        const res = await requestJson(port, '/api/search/groups', 'POST', {
            mode: 'indexed',
            intent: {
                artist: 'Queens of the Stone Age',
                title: 'Songs for the Deaf',
                year: '2002',
                label: 'Interscope',
            },
            page: 1,
            pageSize: 5,
        });

        assert.equal(res.statusCode, 200);
        assert.ok(capturedUrl, 'expected a call to /ws/2/release-group');
        const builtQuery = capturedUrl!.searchParams.get('query') ?? '';
        assert.ok(builtQuery.includes('artist:"Queens of the Stone Age"'));
        assert.ok(builtQuery.includes('releasegroup:"Songs for the Deaf"'));
        assert.ok(builtQuery.includes('firstreleasedate:2002'));
        // Real MusicBrainz probes showed strict AND label terms can
        // over-constrain indexed queries to zero results.
        assert.equal(builtQuery.includes('Interscope'), false);
    } finally {
        await closeServer(server);
    }
});

test('POST /api/search/groups supports artist-only indexed intent payload for direct artist searches', async () => {
    let capturedUrl: URL | undefined;
    globalThis.fetch = (async (input) => {
        const target =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(target);

        if (url.pathname === '/ws/2/release-group') {
            capturedUrl = url;
            return jsonResponse({
                count: 1,
                'release-groups': [
                    {
                        id: 'g-artist-1',
                        title: 'Only by the Night',
                        'first-release-date': '2008-09-19',
                        'primary-type': 'Album',
                        'artist-credit': [{ artist: { name: 'Kings of Leon' } }],
                    },
                ],
            });
        }

        if (url.pathname === '/ws/2/release') {
            return jsonResponse({
                releases: [
                    {
                        id: 'r-artist-1',
                        title: 'Only by the Night',
                        media: [{ format: '12" Vinyl' }],
                        'artist-credit': [{ artist: { name: 'Kings of Leon' } }],
                        'release-group': { id: 'g-artist-1', title: 'Only by the Night' },
                    },
                ],
            });
        }

        if (url.pathname.startsWith('/ws/2/release-group/')) {
            return jsonResponse({ relations: [] });
        }

        return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const { server, port } = await startTestServer();

    try {
        const res = await requestJson(port, '/api/search/groups', 'POST', {
            mode: 'indexed',
            intent: {
                artist: 'Kings of Leon',
            },
            page: 1,
            pageSize: 5,
        });

        assert.equal(res.statusCode, 200);
        assert.ok(capturedUrl, 'expected a call to /ws/2/release-group');
        const builtQuery = capturedUrl!.searchParams.get('query') ?? '';
        assert.ok(builtQuery.includes('artist:"Kings of Leon"'));
        assert.equal(builtQuery.includes('releasegroup:'), false);
    } finally {
        await closeServer(server);
    }
});

test('POST /api/search/groups supports label-only indexed intent payload for direct label searches', async () => {
    let capturedUrl: URL | undefined;
    globalThis.fetch = (async (input) => {
        const target =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(target);

        if (url.pathname === '/ws/2/release-group') {
            capturedUrl = url;
            return jsonResponse({
                count: 1,
                'release-groups': [
                    {
                        id: 'g-label-1',
                        title: 'Random Access Memories',
                        'first-release-date': '2013-05-17',
                        'primary-type': 'Album',
                        'artist-credit': [{ artist: { name: 'Daft Punk' } }],
                    },
                ],
            });
        }

        if (url.pathname === '/ws/2/release') {
            return jsonResponse({
                releases: [
                    {
                        id: 'r-label-1',
                        title: 'Random Access Memories',
                        media: [{ format: '12" Vinyl' }],
                        'artist-credit': [{ artist: { name: 'Daft Punk' } }],
                        'release-group': { id: 'g-label-1', title: 'Random Access Memories' },
                    },
                ],
            });
        }

        if (url.pathname.startsWith('/ws/2/release-group/')) {
            return jsonResponse({ relations: [] });
        }

        return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const { server, port } = await startTestServer();

    try {
        const res = await requestJson(port, '/api/search/groups', 'POST', {
            mode: 'indexed',
            intent: {
                label: 'Columbia',
            },
            page: 1,
            pageSize: 5,
        });

        assert.equal(res.statusCode, 200);
        assert.ok(capturedUrl, 'expected a call to /ws/2/release-group');
        const builtQuery = capturedUrl!.searchParams.get('query') ?? '';
        assert.ok(builtQuery.includes('label:"Columbia"'));
    } finally {
        await closeServer(server);
    }
});

test('POST /api/search/artists returns mapped artist entities with paging metadata', async () => {
    let capturedUrl: URL | undefined;
    globalThis.fetch = (async (input) => {
        const target = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(target);

        if (url.pathname === '/ws/2/artist') {
            capturedUrl = url;
            return jsonResponse({
                count: 12,
                artists: [
                    {
                        id: 'artist-queen',
                        name: 'Queen',
                        disambiguation: 'UK rock band',
                        country: 'GB',
                        area: { name: 'United Kingdom' },
                        'begin-area': { name: 'London' },
                        'sort-name': 'Queen',
                        type: 'Group',
                        score: '100',
                        'life-span': {
                            begin: '1970-01',
                            ended: false,
                        },
                    },
                ],
            });
        }

        return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const { server, port } = await startTestServer();

    try {
        const res = await requestJson(port, '/api/search/artists', 'POST', {
            query: 'Queen',
            page: 2,
            pageSize: 10,
        });

        assert.equal(res.statusCode, 200);
        assert.ok(capturedUrl, 'expected a call to /ws/2/artist');
        assert.equal(capturedUrl!.searchParams.get('query'), 'Queen');
        assert.equal(capturedUrl!.searchParams.get('limit'), '10');
        assert.equal(capturedUrl!.searchParams.get('offset'), '10');

        assert.equal(res.json.query, 'Queen');
        assert.equal(res.json.page, 2);
        assert.equal(res.json.pageSize, 10);
        assert.equal(res.json.total, 12);
        assert.equal(res.json.hasMore, true);
        assert.equal(res.json.entities.length, 1);
        assert.equal(res.json.entities[0].id, 'artist-queen');
        assert.equal(res.json.entities[0].name, 'Queen');
        assert.equal(res.json.entities[0].disambiguation, 'UK rock band');
        assert.equal(res.json.entities[0].country, 'GB');
        assert.equal(res.json.entities[0].area, 'United Kingdom');
        assert.equal(res.json.entities[0].beginArea, 'London');
        assert.equal(res.json.entities[0].lifeSpanBegin, '1970-01');
        assert.equal(res.json.entities[0].lifeSpanEnded, false);
        assert.equal(res.json.entities[0].score, 100);
    } finally {
        await closeServer(server);
    }
});

test('POST /api/search/labels returns mapped label entities with paging metadata', async () => {
    let capturedUrl: URL | undefined;
    globalThis.fetch = (async (input) => {
        const target = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(target);

        if (url.pathname === '/ws/2/label') {
            capturedUrl = url;
            return jsonResponse({
                count: 31,
                labels: [
                    {
                        id: 'label-emi',
                        name: 'EMI',
                        disambiguation: 'UK imprint',
                        country: 'GB',
                        area: { name: 'United Kingdom' },
                        'sort-name': 'EMI',
                        type: 'Original Production',
                        'label-code': 123,
                        score: 88,
                    },
                ],
            });
        }

        return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const { server, port } = await startTestServer();

    try {
        const res = await requestJson(port, '/api/search/labels', 'POST', {
            query: 'EMI',
            page: 1,
            pageSize: 10,
        });

        assert.equal(res.statusCode, 200);
        assert.ok(capturedUrl, 'expected a call to /ws/2/label');
        assert.equal(capturedUrl!.searchParams.get('query'), 'EMI');
        assert.equal(capturedUrl!.searchParams.get('limit'), '10');
        assert.equal(capturedUrl!.searchParams.get('offset'), '0');

        assert.equal(res.json.query, 'EMI');
        assert.equal(res.json.page, 1);
        assert.equal(res.json.pageSize, 10);
        assert.equal(res.json.total, 31);
        assert.equal(res.json.hasMore, true);
        assert.equal(res.json.entities.length, 1);
        assert.equal(res.json.entities[0].id, 'label-emi');
        assert.equal(res.json.entities[0].name, 'EMI');
        assert.equal(res.json.entities[0].disambiguation, 'UK imprint');
        assert.equal(res.json.entities[0].labelCode, '123');
        assert.equal(res.json.entities[0].score, 88);
    } finally {
        await closeServer(server);
    }
});

test('POST /api/search/groups prefers artistId as arid clause for exact artist selection', async () => {
    let capturedUrl: URL | undefined;
    globalThis.fetch = (async (input) => {
        const target = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(target);

        if (url.pathname === '/ws/2/release-group') {
            capturedUrl = url;
            return jsonResponse({
                count: 1,
                'release-groups': [
                    {
                        id: 'g-arid-1',
                        title: 'A Night at the Opera',
                        'artist-credit': [{ artist: { name: 'Queen' } }],
                    },
                ],
            });
        }

        if (url.pathname === '/ws/2/release') {
            return jsonResponse({
                releases: [
                    {
                        id: 'r-arid-1',
                        title: 'A Night at the Opera',
                        media: [{ format: '12" Vinyl' }],
                        'artist-credit': [{ artist: { name: 'Queen' } }],
                        'release-group': { id: 'g-arid-1', title: 'A Night at the Opera' },
                    },
                ],
            });
        }

        if (url.pathname.startsWith('/ws/2/release-group/')) {
            return jsonResponse({ relations: [] });
        }

        return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const { server, port } = await startTestServer();

    try {
        const res = await requestJson(port, '/api/search/groups', 'POST', {
            mode: 'indexed',
            intent: {
                artistId: '0383dadf-2a4e-4d10-a46a-e9e041da8eb3',
                artist: 'Queen',
            },
            page: 1,
            pageSize: 10,
        });

        assert.equal(res.statusCode, 200);
        assert.ok(capturedUrl, 'expected a call to /ws/2/release-group');
        const builtQuery = capturedUrl!.searchParams.get('query') ?? '';
        assert.match(
            builtQuery,
            /arid:0383dadf\\?-2a4e\\?-4d10\\?-a46a\\?-e9e041da8eb3/,
            `expected arid clause in query, got: ${builtQuery}`,
        );
        assert.equal(builtQuery.includes('artist:"Queen"'), false);
    } finally {
        await closeServer(server);
    }
});

test('POST /api/search/groups uses labelId as laid clause for exact label selection', async () => {
    let capturedUrl: URL | undefined;
    globalThis.fetch = (async (input) => {
        const target = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(target);

        if (url.pathname === '/ws/2/release-group') {
            capturedUrl = url;
            return jsonResponse({
                count: 1,
                'release-groups': [
                    {
                        id: 'g-laid-1',
                        title: 'Some Album',
                        'artist-credit': [{ artist: { name: 'Some Artist' } }],
                    },
                ],
            });
        }

        if (url.pathname === '/ws/2/release') {
            return jsonResponse({
                releases: [
                    {
                        id: 'r-laid-1',
                        title: 'Some Album',
                        media: [{ format: 'CD' }],
                        'artist-credit': [{ artist: { name: 'Some Artist' } }],
                        'release-group': { id: 'g-laid-1', title: 'Some Album' },
                    },
                ],
            });
        }

        if (url.pathname.startsWith('/ws/2/release-group/')) {
            return jsonResponse({ relations: [] });
        }

        return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const { server, port } = await startTestServer();

    try {
        const res = await requestJson(port, '/api/search/groups', 'POST', {
            mode: 'indexed',
            intent: {
                labelId: 'c029628b-6633-439e-bcee-ed02e8a338f7',
                label: 'EMI',
            },
            page: 1,
            pageSize: 10,
        });

        assert.equal(res.statusCode, 200);
        assert.ok(capturedUrl, 'expected a call to /ws/2/release-group');
        const builtQuery = capturedUrl!.searchParams.get('query') ?? '';
        assert.match(
            builtQuery,
            /laid:c029628b\\?-6633\\?-439e\\?-bcee\\?-ed02e8a338f7/,
            `expected laid clause in query, got: ${builtQuery}`,
        );
        assert.equal(builtQuery.includes('label:"EMI"'), false);
    } finally {
        await closeServer(server);
    }
});

test('POST /api/search/groups supports indexed primaryTypes include clauses', async () => {
    let capturedUrl: URL | undefined;
    globalThis.fetch = (async (input) => {
        const target = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(target);

        if (url.pathname === '/ws/2/release-group') {
            capturedUrl = url;
            return jsonResponse({
                count: 1,
                'release-groups': [
                    {
                        id: 'g-type-include-1',
                        title: 'Test Album',
                        'artist-credit': [{ artist: { name: 'Test Artist' } }],
                    },
                ],
            });
        }

        if (url.pathname === '/ws/2/release') {
            return jsonResponse({
                releases: [
                    {
                        id: 'r-type-include-1',
                        title: 'Test Album',
                        media: [{ format: '12" Vinyl' }],
                        'artist-credit': [{ artist: { name: 'Test Artist' } }],
                        'release-group': { id: 'g-type-include-1', title: 'Test Album' },
                    },
                ],
            });
        }

        if (url.pathname.startsWith('/ws/2/release-group/')) {
            return jsonResponse({ relations: [] });
        }

        return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const { server, port } = await startTestServer();

    try {
        const res = await requestJson(port, '/api/search/groups', 'POST', {
            mode: 'indexed',
            intent: {
                artistId: '0383dadf-2a4e-4d10-a46a-e9e041da8eb3',
                primaryTypes: ['album', 'ep'],
            },
            page: 1,
            pageSize: 10,
        });

        assert.equal(res.statusCode, 200);
        assert.ok(capturedUrl, 'expected a call to /ws/2/release-group');
        const builtQuery = capturedUrl!.searchParams.get('query') ?? '';
        assert.ok(
            builtQuery.includes('arid:0383dadf\\-2a4e\\-4d10\\-a46a\\-e9e041da8eb3'),
            `expected arid clause in query, got: ${builtQuery}`,
        );
        assert.ok(builtQuery.includes('(primarytype:album OR primarytype:ep)'));
    } finally {
        await closeServer(server);
    }
});

test('POST /api/search/groups supports indexed excludePrimaryTypes clauses', async () => {
    let capturedUrl: URL | undefined;
    globalThis.fetch = (async (input) => {
        const target = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(target);

        if (url.pathname === '/ws/2/release-group') {
            capturedUrl = url;
            return jsonResponse({
                count: 1,
                'release-groups': [
                    {
                        id: 'g-type-exclude-1',
                        title: 'Test Other Type',
                        'artist-credit': [{ artist: { name: 'Test Artist' } }],
                    },
                ],
            });
        }

        if (url.pathname === '/ws/2/release') {
            return jsonResponse({
                releases: [
                    {
                        id: 'r-type-exclude-1',
                        title: 'Test Other Type',
                        media: [{ format: 'CD' }],
                        'artist-credit': [{ artist: { name: 'Test Artist' } }],
                        'release-group': { id: 'g-type-exclude-1', title: 'Test Other Type' },
                    },
                ],
            });
        }

        if (url.pathname.startsWith('/ws/2/release-group/')) {
            return jsonResponse({ relations: [] });
        }

        return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const { server, port } = await startTestServer();

    try {
        const res = await requestJson(port, '/api/search/groups', 'POST', {
            mode: 'indexed',
            intent: {
                artistId: '0383dadf-2a4e-4d10-a46a-e9e041da8eb3',
                excludePrimaryTypes: ['album', 'single', 'ep'],
            },
            page: 1,
            pageSize: 10,
        });

        assert.equal(res.statusCode, 200);
        assert.ok(capturedUrl, 'expected a call to /ws/2/release-group');
        const builtQuery = capturedUrl!.searchParams.get('query') ?? '';
        assert.ok(builtQuery.includes('NOT primarytype:album'));
        assert.ok(builtQuery.includes('NOT primarytype:single'));
        assert.ok(builtQuery.includes('NOT primarytype:ep'));
    } finally {
        await closeServer(server);
    }
});
