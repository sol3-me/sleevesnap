import express from 'express';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { searchRouter, searchReleasesByText } from './search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Real /ws/2/release-group search responses for "queens of the stone age",
// captured live at offset 0/5/10 (limit=5 each), plus a consolidated map of
// real /ws/2/release?query=rgid:X responses (format info) for every
// candidate release-group id appearing across those three pages. Together
// these reproduce a genuine real-world case: only 2 of the first 15
// candidate release-groups have any vinyl release (most of the rest are
// digital-only tribute/parody releases) — a faithful regression fixture for
// the release-group-primary search refactor.
function loadRgFixture(name: string) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf-8'));
}

const rgPage1 = loadRgFixture('release-group-search-qotsa-page1-real.json');
const rgPage2 = loadRgFixture('release-group-search-qotsa-page2-real.json');
const rgPage3 = loadRgFixture('release-group-search-qotsa-page3-real.json');
const rgReleasesById = loadRgFixture('release-group-releases-by-id-qotsa-real.json') as Record<string, unknown>;

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
            capturedUrl = url;
            return jsonResponse({ count: 1, 'release-groups': [
                {
                    id: 'g1',
                    title: 'Rated R',
                    'first-release-date': '2000-01-01',
                    'primary-type': 'Album',
                    'artist-credit': [{ artist: { name: 'Queens of the Stone Age' } }],
                },
            ] });
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
            formats: ['vinyl'],
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

test('POST /api/search/groups fills a full page from the first raw batch when enough candidates match (real data)', async () => {
    globalThis.fetch = mockReleaseGroupEndpoints();

    const { server, port } = await startTestServer();

    try {
        const res = await requestJson(port, '/api/search/groups', 'POST', {
            query: 'queens of the stone age',
            page: 1,
            pageSize: 5,
            formats: ['vinyl', 'cd'],
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.json.total, 96);
        assert.equal(res.json.isTotalExact, true);
        assert.equal(res.json.hasMore, true);
        assert.deepEqual(
            res.json.groups.map((g: { releaseGroupId: string }) => g.releaseGroupId),
            [
                '17ee0d7f-4a9d-317f-a0b0-8ca528a34b19', // Queens of the Stone Age (vinyl)
                '351ed669-d97b-4b2e-80c2-e9c504992c13', // Kyuss / Queens of the Stone Age (CD)
                '95335849-2536-344f-acb6-0424c7d56411', // Queens of the Stone Age / Beaver (vinyl)
                '1893cf55-0a80-4465-890b-6da7db246f0e', // Uncovered Queens of the Stone Age (CD)
                'd6657084-d471-3b6a-9b6d-17621da96cdb', // Lullaby Renditions of Queens of the Stone Age (CD)
            ],
        );
    } finally {
        await closeServer(server);
    }
});

test('POST /api/search/groups excludes format-mismatched candidates and gives up gracefully after the retry cap (real data)', async () => {
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
        // Vinyl-only: of the 15 real candidates across pages 1-3 (offsets
        // 0/5/10), only 2 have any vinyl release — the rest are digital-only
        // tribute/parody releases. This should exhaust all 3 retry rounds and
        // still come back with just those 2, honestly marked as inexact.
        const res = await requestJson(port, '/api/search/groups', 'POST', {
            query: 'queens of the stone age',
            page: 1,
            pageSize: 5,
            formats: ['vinyl'],
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.json.isTotalExact, false);
        assert.equal(res.json.hasMore, true);
        assert.deepEqual(
            res.json.groups.map((g: { releaseGroupId: string }) => g.releaseGroupId),
            [
                '17ee0d7f-4a9d-317f-a0b0-8ca528a34b19', // Queens of the Stone Age
                '95335849-2536-344f-acb6-0424c7d56411', // Queens of the Stone Age / Beaver
            ],
        );
        assert.equal(releaseGroupSearchCalls, 3, 'should stop after exactly 3 raw-batch rounds');
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
            formats: ['vinyl'],
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

test('POST /api/search/groups returns empty page when no formats are selected', async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
        fetchCalls += 1;
        return jsonResponse({ error: 'unexpected request' }, 500);
    }) as typeof fetch;

    const { server, port } = await startTestServer();

    try {
        const res = await requestJson(port, '/api/search/groups', 'POST', {
            query: 'Rated R',
            page: 1,
            pageSize: 5,
            formats: [],
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.json.total, 0);
        assert.equal(res.json.hasMore, false);
        assert.equal(res.json.isTotalExact, true);
        assert.deepEqual(res.json.groups, []);
        assert.equal(fetchCalls, 0);
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
