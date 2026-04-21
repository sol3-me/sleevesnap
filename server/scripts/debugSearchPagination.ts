import express from 'express';
import { searchRouter } from '../routes/search.js';

const QUERY = process.argv[2] ?? 'Rated R';
const RAW_FORMATS = process.argv[3] ?? 'vinyl';
const PAGE_SIZE = 5;
const PAGES_TO_CHECK = [1, 2, 3];
const FORMATS = RAW_FORMATS
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is 'vinyl' | 'cd' => value === 'vinyl' || value === 'cd');

function isVinyl(format: string | undefined): boolean {
    if (!format) return false;
    return /vinyl|\blp\b/i.test(format);
}

function isCd(format: string | undefined): boolean {
    if (!format) return false;
    return /\bcd\b/i.test(format);
}

async function main(): Promise<void> {
    const app = express();
    app.use(express.json());
    app.use('/api/search', searchRouter);

    const server = await new Promise<import('node:http').Server>((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Could not bind debug server port');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
        console.log(`Query: ${QUERY}`);
        console.log(`Page size: ${PAGE_SIZE}`);
        console.log(`Formats: ${FORMATS.join(', ') || '(none)'}`);

        for (const page of PAGES_TO_CHECK) {
            const pageRes = await fetch(`${baseUrl}/api/search/groups`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ query: QUERY, page, pageSize: PAGE_SIZE, formats: FORMATS }),
            });

            const pageJson = (await pageRes.json()) as {
                total?: number;
                hasMore?: boolean;
                isTotalExact?: boolean;
                groups?: Array<{ releaseGroupId: string; title: string; artist: string }>;
            };

            if (!Array.isArray(pageJson.groups)) {
                console.log(`\nPage ${page}: failed to load groups`);
                continue;
            }

            console.log(
                `\nPage ${page}: total=${pageJson.total ?? 0} (${pageJson.isTotalExact ? 'exact' : 'loaded so far'}), hasMore=${Boolean(pageJson.hasMore)}, groupsOnPage=${pageJson.groups.length}`,
            );

            let vinylVisible = 0;

            for (const group of pageJson.groups) {
                const detailRes = await fetch(
                    `${baseUrl}/api/search/groups/${encodeURIComponent(group.releaseGroupId)}/releases`,
                );
                const detailJson = (await detailRes.json()) as {
                    releases?: Array<{ format?: string }>;
                };

                const releases = detailJson.releases ?? [];
                const vinylCount = releases.filter((r) => isVinyl(r.format)).length;
                const cdCount = releases.filter((r) => isCd(r.format)).length;
                const unknownCount = releases.filter((r) => !r.format).length;
                const formatSet = Array.from(
                    new Set(
                        releases
                            .map((r) => r.format)
                            .filter((f): f is string => Boolean(f)),
                    ),
                );

                if (vinylCount > 0) {
                    vinylVisible += 1;
                }

                console.log(
                    `  - ${group.title} | ${group.artist} | releases=${releases.length} vinyl=${vinylCount} cd=${cdCount} unknown=${unknownCount} formats=${formatSet.slice(0, 5).join(' | ') || 'none'}`,
                );
            }

            console.log(`  -> groups visible with Vinyl-only filter: ${vinylVisible}/${pageJson.groups.length}`);
        }
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
