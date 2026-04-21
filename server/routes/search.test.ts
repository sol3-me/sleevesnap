import express from 'express';
import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, test } from 'node:test';
import { searchRouter } from './search.js';

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
