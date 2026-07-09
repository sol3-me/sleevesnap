import express from 'express';
import { searchRouter } from '../routes/search.js';

async function startServer() {
    const app = express();
    app.use(express.json());
    app.use('/api/search', searchRouter);

    return await new Promise<import('node:http').Server>((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
}

async function callSearch(baseUrl: string, name: string, body: unknown) {
    const res = await fetch(`${baseUrl}/api/search/groups`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

    const json = (await res.json()) as {
        total?: number;
        query?: string;
        groups?: Array<{
            title: string;
            artist: string;
            primaryType?: string;
            firstReleaseDate?: string;
        }>;
    };

    const top = (json.groups ?? []).slice(0, 5).map((g) => ({
        title: g.title,
        artist: g.artist,
        primaryType: g.primaryType,
        firstReleaseDate: g.firstReleaseDate,
    }));

    console.log(`\n=== ${name} ===`);
    console.log(
        JSON.stringify(
            {
                status: res.status,
                total: json.total ?? 0,
                returned: json.groups?.length ?? 0,
                query: json.query ?? '',
                top,
            },
            null,
            2,
        ),
    );
}

async function main() {
    const server = await startServer();
    const address = server.address();

    if (!address || typeof address === 'string') {
        throw new Error('Could not resolve ephemeral port');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
        await callSearch(baseUrl, 'simple_single_box', {
            query: 'Queens of the Stone Age Songs for the Deaf 2002 Interscope',
            page: 1,
            pageSize: 5,
        });

        await callSearch(baseUrl, 'indexed_with_label', {
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

        await callSearch(baseUrl, 'indexed_without_label', {
            mode: 'indexed',
            intent: {
                artist: 'Queens of the Stone Age',
                title: 'Songs for the Deaf',
                year: '2002',
            },
            page: 1,
            pageSize: 5,
        });
    } finally {
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
}

void main();
