import express from 'express';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { searchRouter, searchReleasesByText } from './search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Real MusicBrainz response, captured via:
//   curl "https://musicbrainz.org/ws/2/release?query=(releasegroup:\"queens of
//   the stone age\" OR release:\"queens of the stone age\" OR
//   artist:\"queens of the stone age\")&fmt=json&type=album&inc=media&limit=100&offset=0"
// Regression fixture for a real pagination bug report: page 2 of the
// Discover search was coming back empty for this exact query.
const qotsaFixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, '__fixtures__', 'qotsa-release-search-real.json'), 'utf-8'),
);

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

test('POST /api/search/groups paginates filtered release groups instead of raw API total', async () => {
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
            assert.equal(url.searchParams.get('offset'), '0');
            assert.equal(
                url.searchParams.get('query'),
                '(releasegroup:"Rated R" OR release:"Rated R" OR artist:"Rated R")',
            );

            return jsonResponse({
                count: 9999,
                releases: [
                    {
                        id: 'r1',
                        title: 'Rated R',
                        date: '2000-01-01',
                        media: [{ format: '12" Vinyl' }],
                        'artist-credit': [{ artist: { name: 'Artist A' } }],
                        'release-group': { id: 'g1', title: 'Rated R', 'primary-type': 'Album' },
                    },
                    {
                        id: 'r2',
                        title: 'Rated R',
                        date: '2001-01-01',
                        media: [{ format: 'CD' }],
                        'artist-credit': [{ artist: { name: 'Artist B' } }],
                        'release-group': { id: 'g2', title: 'Rated R' },
                    },
                    {
                        id: 'r3',
                        title: 'Rated R',
                        date: '2002-01-01',
                        media: [{ format: '12" Vinyl' }],
                        'artist-credit': [{ artist: { name: 'Artist C' } }],
                        'release-group': { id: 'g3', title: 'Rated R' },
                    },
                    {
                        id: 'r4',
                        title: 'Rated R',
                        date: '2003-01-01',
                        media: [{ format: 'Digital Media' }],
                        'artist-credit': [{ artist: { name: 'Artist D' } }],
                        'release-group': { id: 'g4', title: 'Rated R' },
                    },
                    {
                        id: 'r5',
                        title: 'Rated R',
                        date: '2004-01-01',
                        media: [{ format: '12" Vinyl' }],
                        'artist-credit': [{ artist: { name: 'Artist E' } }],
                        'release-group': { id: 'g5', title: 'Rated R' },
                    },
                ],
            });
        }

        if (url.pathname === '/ws/2/release-group/g1') {
            return jsonResponse({
                relations: [{ type: 'discogs', url: { resource: 'https://www.discogs.com/master/1001' } }],
            });
        }

        if (url.pathname === '/ws/2/release-group/g3') {
            return jsonResponse({ relations: [] });
        }

        return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const { server, port } = await startTestServer();

    try {
        const res = await requestJson(port, '/api/search/groups', 'POST', {
            query: 'Rated R',
            page: 1,
            pageSize: 2,
            formats: ['vinyl'],
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.json.page, 1);
        assert.equal(res.json.pageSize, 2);
        assert.equal(res.json.total, 3);
        assert.equal(res.json.isTotalExact, true);
        assert.equal(res.json.hasMore, true);
        assert.equal(res.json.groups.length, 2);
        assert.deepEqual(
            res.json.groups.map((g: { releaseGroupId: string }) => g.releaseGroupId),
            ['g1', 'g3'],
        );
        assert.equal(res.json.groups[0].discogsMasterUrl, 'https://www.discogs.com/master/1001');
        assert.deepEqual(res.json.groups[0].availableFormats, ['12" Vinyl']);
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

test('POST /api/search/groups paginates a real MusicBrainz response correctly (regression: page 2 was empty)', async () => {
    globalThis.fetch = (async (input) => {
        const target =
            typeof input === 'string'
                ? input
                : input instanceof URL
                    ? input.toString()
                    : input.url;
        const url = new URL(target);

        if (url.pathname === '/ws/2/release') {
            // Every real request in this scenario is satisfied by a single
            // 100-release batch at offset 0 (14 vinyl groups are found before
            // the scan ever needs a second batch) — anything else returns no
            // releases so an unexpected extra batch fails loudly instead of
            // silently returning wrong data.
            if (url.searchParams.get('offset') === '0') {
                return jsonResponse(qotsaFixture);
            }
            return jsonResponse({ releases: [] });
        }

        if (url.pathname.startsWith('/ws/2/release-group/')) {
            return jsonResponse({ relations: [] });
        }

        return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const { server, port } = await startTestServer();

    try {
        const page1 = await requestJson(port, '/api/search/groups', 'POST', {
            query: 'queens of the stone age',
            page: 1,
            pageSize: 5,
            formats: ['vinyl'],
        });

        assert.equal(page1.statusCode, 200);
        assert.equal(page1.json.total, 14);
        assert.equal(page1.json.hasMore, true);
        assert.equal(page1.json.isTotalExact, false);
        assert.deepEqual(
            page1.json.groups.map((g: { releaseGroupId: string }) => g.releaseGroupId),
            [
                '17ee0d7f-4a9d-317f-a0b0-8ca528a34b19', // Queens of the Stone Age
                '95335849-2536-344f-acb6-0424c7d56411', // Queens of the Stone Age / Beaver
                '7e7270ae-a73a-48e2-a8a6-20e1112e21f8', // Villains
                'ca1bf5c4-5402-3f23-b5f2-1f54a1f2f237', // Make It Wit Chu
                '5b2f4dfd-35db-4577-8641-249ef577f9a1', // Unplugged & Paralyzed
            ],
        );

        const page2 = await requestJson(port, '/api/search/groups', 'POST', {
            query: 'queens of the stone age',
            page: 2,
            pageSize: 5,
            formats: ['vinyl'],
        });

        assert.equal(page2.statusCode, 200);
        assert.equal(page2.json.total, 14);
        // This is the exact bug report: page 2 was coming back with an empty
        // `groups` array even though page 1 reported 14 matching groups.
        assert.equal(page2.json.groups.length, 5, 'page 2 should not be empty');
        assert.deepEqual(
            page2.json.groups.map((g: { releaseGroupId: string }) => g.releaseGroupId),
            [
                'c92f73ee-527f-42ed-a556-fd615941e214', // …Like Clockwork
                '5967a9ad-a0d5-34f7-bd53-f5d4bad80a67', // Lullabies to Paralyze
                '21164f7f-6452-3889-aaaa-662b95772276', // The Fun Machine Took a Shit & Died
                '7818bb84-ed80-3488-9f50-f9bf4347e372', // Rated R
                '9f7ff015-241b-43cb-a02e-b5c61bbbfd70', // You Can't Put Your Arms Around a Memory
            ],
        );

        // Guard against the underlying fragility this bug came from: paging
        // through results must never show the same release group twice.
        const page1Ids = new Set(page1.json.groups.map((g: { releaseGroupId: string }) => g.releaseGroupId));
        const overlap = page2.json.groups.filter((g: { releaseGroupId: string }) => page1Ids.has(g.releaseGroupId));
        assert.deepEqual(overlap, [], 'page 1 and page 2 must not share any release groups');
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
