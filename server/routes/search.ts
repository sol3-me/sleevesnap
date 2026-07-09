import { Router } from 'express';
import { logEvent, logWarn, newRequestId } from '../logger.js';
import {
    createMusicBrainzCatalogGateway,
    SearchGroupsRequest,
    SearchReleaseResult,
} from '../services/search/musicbrainzCatalogGateway.js';

export const searchRouter = Router();

const DEFAULT_GROUP_PAGE_SIZE = 10;
const MAX_GROUP_PAGE_SIZE = 25;
const FLAT_SEARCH_LIMIT = 15;
const DEFAULT_ENTITY_PAGE_SIZE = 10;
const MAX_ENTITY_PAGE_SIZE = 25;

const appName = process.env.MUSICBRAINZ_APP_NAME ?? 'sleevesnap';
const gateway = createMusicBrainzCatalogGateway(appName);

// POST /api/search  – flat search list (kept for scanner compatibility)
searchRouter.post('/', async (req, res) => {
    const requestId = newRequestId();
    const startedAt = Date.now();
    const { query, includeOtherFormats } = req.body as {
        query?: string;
        includeOtherFormats?: boolean;
    };

    if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'query is required' });
        return;
    }

    logEvent('search', requestId, 'Manual search request', {
        query,
        includeOtherFormats: Boolean(includeOtherFormats),
    });

    try {
        const releases = await gateway.searchReleasesByText(query, FLAT_SEARCH_LIMIT);
        const mapped = includeOtherFormats ? releases : releases.filter((release) => isVinylFormat(release.format));

        logEvent('search', requestId, 'Manual search results', {
            resultCount: mapped.length,
            top: mapped.slice(0, 3).map((r) => `${r.artist} - ${r.title}`),
            ms: Date.now() - startedAt,
        });

        res.json(mapped);
    } catch (err) {
        logWarn('search', requestId, 'Manual search failed', { query, error: String(err) });
        res.status(502).json({ error: 'Failed to search records' });
    }
});

// POST /api/search/groups  – grouped by release group for the Discover view.
searchRouter.post('/groups', async (req, res) => {
    const requestId = newRequestId();
    const startedAt = Date.now();
    const body = req.body as SearchGroupsRequest;

    const safePage = Math.max(1, Number(body.page ?? 1));
    const safePageSize = Math.max(
        1,
        Math.min(MAX_GROUP_PAGE_SIZE, Number(body.pageSize ?? DEFAULT_GROUP_PAGE_SIZE)),
    );

    const hasPlainQuery = typeof body.query === 'string' && body.query.trim().length > 0;
    const hasIntent = typeof body.intent === 'object' && body.intent !== null;

    if (!hasPlainQuery && !hasIntent) {
        res.status(400).json({ error: 'query is required' });
        return;
    }

    try {
        logEvent('search', requestId, 'Discover search request', {
            query: body.query,
            mode: body.mode ?? 'simple',
            hasIntent,
            page: safePage,
            pageSize: safePageSize,
        });

        const result = await gateway.searchGroups({
            query: body.query,
            intent: body.intent,
            mode: body.mode,
            page: safePage,
            pageSize: safePageSize,
        });

        logEvent('search', requestId, 'Discover search results', {
            resultCount: result.groups.length,
            total: result.total,
            isTotalExact: result.isTotalExact,
            hasMore: result.hasMore,
            top: result.groups.slice(0, 3).map((g) => `${g.artist} - ${g.title}`),
            ms: Date.now() - startedAt,
        });

        res.json(result);
    } catch (err) {
        logWarn('search', requestId, 'Discover search failed', {
            query: body.query,
            mode: body.mode ?? 'simple',
            error: String(err),
        });
        res.status(502).json({ error: 'Failed to search records' });
    }
});

// POST /api/search/artists  – entity lookup for artist disambiguation.
searchRouter.post('/artists', async (req, res) => {
    const requestId = newRequestId();
    const startedAt = Date.now();
    const body = req.body as { query?: string; page?: number; pageSize?: number };

    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
        res.status(400).json({ error: 'query is required' });
        return;
    }

    const safePage = Math.max(1, Number(body.page ?? 1));
    const safePageSize = Math.max(
        1,
        Math.min(MAX_ENTITY_PAGE_SIZE, Number(body.pageSize ?? DEFAULT_ENTITY_PAGE_SIZE)),
    );

    try {
        logEvent('search', requestId, 'Artist entity search request', {
            query,
            page: safePage,
            pageSize: safePageSize,
        });

        const result = await gateway.searchArtists(query, safePage, safePageSize);

        logEvent('search', requestId, 'Artist entity search results', {
            query,
            page: safePage,
            pageSize: safePageSize,
            total: result.total,
            returned: result.entities.length,
            hasMore: result.hasMore,
            ms: Date.now() - startedAt,
        });

        res.json(result);
    } catch (err) {
        logWarn('search', requestId, 'Artist entity search failed', {
            query,
            page: safePage,
            pageSize: safePageSize,
            error: String(err),
        });
        res.status(502).json({ error: 'Failed to search artists' });
    }
});

// POST /api/search/labels  – entity lookup for label disambiguation.
searchRouter.post('/labels', async (req, res) => {
    const requestId = newRequestId();
    const startedAt = Date.now();
    const body = req.body as { query?: string; page?: number; pageSize?: number };

    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
        res.status(400).json({ error: 'query is required' });
        return;
    }

    const safePage = Math.max(1, Number(body.page ?? 1));
    const safePageSize = Math.max(
        1,
        Math.min(MAX_ENTITY_PAGE_SIZE, Number(body.pageSize ?? DEFAULT_ENTITY_PAGE_SIZE)),
    );

    try {
        logEvent('search', requestId, 'Label entity search request', {
            query,
            page: safePage,
            pageSize: safePageSize,
        });

        const result = await gateway.searchLabels(query, safePage, safePageSize);

        logEvent('search', requestId, 'Label entity search results', {
            query,
            page: safePage,
            pageSize: safePageSize,
            total: result.total,
            returned: result.entities.length,
            hasMore: result.hasMore,
            ms: Date.now() - startedAt,
        });

        res.json(result);
    } catch (err) {
        logWarn('search', requestId, 'Label entity search failed', {
            query,
            page: safePage,
            pageSize: safePageSize,
            error: String(err),
        });
        res.status(502).json({ error: 'Failed to search labels' });
    }
});

// GET /api/search/groups/:releaseGroupId/releases  – lazy-loaded release list for one group
searchRouter.get('/groups/:releaseGroupId/releases', async (req, res) => {
    const { releaseGroupId } = req.params;

    if (!releaseGroupId) {
        res.status(400).json({ error: 'releaseGroupId is required' });
        return;
    }

    try {
        const result = await gateway.getReleaseGroupReleases(releaseGroupId);
        res.json(result);
    } catch (err) {
        console.error('[search/groups/:id/releases] Error querying MusicBrainz:', err);
        res.status(502).json({ error: 'Failed to load release group releases' });
    }
});

/**
 * Searches MusicBrainz by free-text query and returns vinyl-format results,
 * mirroring the filtering behaviour of `POST /` above. Exported for reuse by
 * the vision-assisted scan flow to validate an AI guess.
 */
export async function searchReleasesByText(
    query: string,
    _appName: string,
    limit: number,
): Promise<SearchReleaseResult[]> {
    return gateway.searchReleasesByText(query, limit);
}

function isVinylFormat(format: string | undefined): boolean {
    if (!format) return false;
    return /vinyl|\blp\b/i.test(format);
}
