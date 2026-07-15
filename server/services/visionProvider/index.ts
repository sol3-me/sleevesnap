import { Jimp } from 'jimp';
import { logEvent, logWarn } from '../../logger.js';

export interface VisionScanResult {
  artist: string;
  title: string;
  year?: string;
  genre?: string;
  confidence: number;
}

export interface VisionIdentifyResult {
  /** False when the AI determined the photo does not show a record sleeve at all. */
  isAlbumCover: boolean;
  /** Candidate identifications, sorted by confidence descending. Empty when isAlbumCover is false. */
  guesses: VisionScanResult[];
}

const MAX_WIDTH = 1024;
const DEFAULT_MAX_GUESSES = 5;
const DEFAULT_MIN_GUESSES = 3;
const GEMINI_MODEL = 'gemini-2.5-flash';
const OPENAI_MODEL = 'gpt-5.4-nano';
const REQUEST_TIMEOUT_MS = 10000;
const SCOPE = 'vision';

function clampGuessLimits(rawMin: number, rawMax: number): { min: number; max: number } {
  const max = Math.min(10, Math.max(1, rawMax));
  const min = Math.min(max, Math.max(1, rawMin));
  return { min, max };
}

function getGuessLimits() {
  const configuredMax = Number(process.env.VISION_MAX_GUESSES ?? DEFAULT_MAX_GUESSES);
  const configuredMin = Number(process.env.VISION_MIN_GUESSES ?? DEFAULT_MIN_GUESSES);
  return clampGuessLimits(configuredMin, configuredMax);
}

function buildPrompt(minGuesses: number, maxGuesses: number) {
  return (
    'You are analyzing a single photo to identify a vinyl record sleeve (front or back album cover art). ' +
    'First decide whether the photo actually shows a vinyl/album record sleeve. If it does NOT — for example ' +
    'it shows a person, an animal, a random object, or anything else that is not album cover art — set ' +
    '"isAlbumCover" to false and return an empty "guesses" array. Do not invent an artist or title for a ' +
    'non-album photo, no matter how tempting; a wrong guess wastes the user\'s limited daily scan allowance. ' +
    `If it DOES show a record sleeve, set "isAlbumCover" to true and fill "guesses" with a JSON array of ` +
    `candidate identifications, sorted by confidence descending, with at least ${minGuesses} guesses when ` +
    `possible and up to ${maxGuesses} guesses if uncertain. Each guess must include artist name, album title, ` +
    'and confidence (0 to 1). If you can determine the release year or genre, include them. Ignore background ' +
    'objects — focus only on the record sleeve itself.'
  );
}

function buildResultSchema(maxGuesses: number) {
  return {
    type: 'object',
    properties: {
      isAlbumCover: { type: 'boolean' },
      guesses: {
        type: 'array',
        maxItems: maxGuesses,
        items: {
          type: 'object',
          properties: {
            artist: { type: 'string' },
            title: { type: 'string' },
            year: { type: 'string' },
            genre: { type: 'string' },
            confidence: { type: 'number' },
          },
          required: ['artist', 'title', 'confidence'],
        },
      },
    },
    required: ['isAlbumCover', 'guesses'],
  };
}

/**
 * Resizes `imageBuffer` to a max width of 1024px (preserving aspect ratio,
 * only ever downscaling) and re-encodes as JPEG, to control both request
 * latency and provider token cost.
 */
async function resizeForVision(imageBuffer: Buffer): Promise<Buffer> {
  const image = await Jimp.fromBuffer(imageBuffer);
  if (image.bitmap.width > MAX_WIDTH) {
    image.resize({ w: MAX_WIDTH });
  }
  return image.getBuffer('image/jpeg');
}

/**
 * Parses a provider's raw JSON-string reply into a normalized result.
 *
 * Expects the `{ isAlbumCover, guesses }` shape the schema now requests, but
 * defensively also accepts a bare guesses array or a single bare guess
 * object (the old contract) so a model that ignores the schema still
 * degrades to "treat as an album cover" rather than silently dropping
 * guesses. Only an explicit `isAlbumCover: false` is treated as a decline —
 * anything else defaults to true, since falsely declining a real sleeve
 * photo is worse than an unnecessary search.
 */
function parseResults(raw: string | undefined, requestId: string, provider: string, maxGuesses: number): VisionIdentifyResult {
  const ambiguous: VisionIdentifyResult = { isAlbumCover: true, guesses: [] };

  if (!raw) {
    logWarn(SCOPE, requestId, `${provider} returned an empty response body`);
    return ambiguous;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    let isAlbumCover = true;
    let rawGuesses: unknown;
    if (Array.isArray(parsed)) {
      rawGuesses = parsed;
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as { isAlbumCover?: unknown; guesses?: unknown };
      if (typeof obj.isAlbumCover === 'boolean') {
        isAlbumCover = obj.isAlbumCover;
      }
      rawGuesses = Array.isArray(obj.guesses) ? obj.guesses : [parsed];
    } else {
      rawGuesses = [];
    }

    if (!isAlbumCover) {
      logEvent(SCOPE, requestId, `${provider} determined the photo is not a record sleeve`);
      return { isAlbumCover: false, guesses: [] };
    }

    const candidates = (rawGuesses as Array<Partial<VisionScanResult>>) ?? [];
    const cleaned = candidates
      .filter((candidate) => typeof candidate.artist === 'string' && typeof candidate.title === 'string')
      .map((candidate) => ({
        artist: candidate.artist!.trim(),
        title: candidate.title!.trim(),
        year: typeof candidate.year === 'string' ? candidate.year : undefined,
        genre: typeof candidate.genre === 'string' ? candidate.genre : undefined,
        confidence:
          typeof candidate.confidence === 'number'
            ? Math.max(0, Math.min(1, candidate.confidence))
            : 0,
      }))
      .filter((candidate) => candidate.artist.length > 0 && candidate.title.length > 0);

    if (cleaned.length === 0) {
      return ambiguous;
    }

    const deduped = new Map<string, VisionScanResult>();
    for (const candidate of cleaned) {
      const key = `${candidate.artist.toLowerCase()}::${candidate.title.toLowerCase()}`;
      const existing = deduped.get(key);
      if (!existing || candidate.confidence > existing.confidence) {
        deduped.set(key, candidate);
      }
    }

    return {
      isAlbumCover: true,
      guesses: Array.from(deduped.values())
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, maxGuesses),
    };
  } catch {
    logWarn(SCOPE, requestId, `${provider} response was not valid JSON`, { raw: raw.slice(0, 300) });
    return ambiguous;
  }
}

async function identifyWithGemini(imageBuffer: Buffer, requestId: string): Promise<VisionIdentifyResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { isAlbumCover: true, guesses: [] };
  const { min, max } = getGuessLimits();
  const prompt = buildPrompt(min, max);
  const resultSchema = buildResultSchema(max);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/jpeg', data: imageBuffer.toString('base64') } },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: resultSchema,
      },
    }),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '<failed to read response body>');
    throw new Error(
      `Gemini vision request failed: model=${GEMINI_MODEL} status=${res.status} ${res.statusText} body=${bodyText.slice(0, 500)}`,
    );
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return parseResults(data.candidates?.[0]?.content?.parts?.[0]?.text, requestId, 'Gemini', max);
}

async function identifyWithOpenAI(imageBuffer: Buffer, requestId: string): Promise<VisionIdentifyResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { isAlbumCover: true, guesses: [] };
  const { min, max } = getGuessLimits();
  const prompt = buildPrompt(min, max);
  const resultSchema = buildResultSchema(max);

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'vinyl_identification', schema: resultSchema },
      },
    }),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '<failed to read response body>');
    throw new Error(
      `OpenAI vision request failed: model=${OPENAI_MODEL} status=${res.status} ${res.statusText} body=${bodyText.slice(0, 500)}`,
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return parseResults(data.choices?.[0]?.message?.content, requestId, 'OpenAI', max);
}

/**
 * Identifies the single vinyl sleeve in `imageBuffer` using an AI vision
 * provider. Tries Gemini first, falls back to OpenAI when Gemini merely
 * fails or comes back ambiguous (isAlbumCover true but no guesses) — but
 * NOT when Gemini gives a definitive "this isn't a record sleeve" answer,
 * since that's a useful result in its own right, not a failure to recover
 * from. Never throws — returns an ambiguous result when both providers fail
 * or neither API key is configured, so callers can treat this as a plain
 * "no suggestion" signal.
 *
 * `requestId` ties every log line here back to the originating /api/scan
 * request — pass the same id you're already logging with in the caller.
 *
 * NOTE: Gemini's exact request/response envelope below is based on the
 * long-documented `generateContent` REST shape (contents/parts/inlineData,
 * generationConfig.responseSchema). This could not be reliably re-confirmed
 * against live docs during design — verify against
 * https://ai.google.dev/gemini-api/docs/image-understanding if calls start
 * failing unexpectedly.
 */
export async function identifyVinyl(imageBuffer: Buffer, requestId = 'unknown'): Promise<VisionIdentifyResult> {
  const ambiguous: VisionIdentifyResult = { isAlbumCover: true, guesses: [] };

  let resized: Buffer;
  try {
    resized = await resizeForVision(imageBuffer);
    logEvent(SCOPE, requestId, 'Image resized for vision providers', {
      originalBytes: imageBuffer.length,
      resizedBytes: resized.length,
    });
  } catch (err) {
    logWarn(SCOPE, requestId, 'Failed to resize image for vision providers', { error: String(err) });
    return ambiguous;
  }

  if (process.env.GEMINI_API_KEY) {
    const startedAt = Date.now();
    try {
      const geminiResult = await identifyWithGemini(resized, requestId);
      logEvent(SCOPE, requestId, 'Gemini call complete', {
        ms: Date.now() - startedAt,
        isAlbumCover: geminiResult.isAlbumCover,
        resultCount: geminiResult.guesses.length,
        top: geminiResult.guesses[0],
      });
      if (!geminiResult.isAlbumCover || geminiResult.guesses.length > 0) return geminiResult;
    } catch (err) {
      logWarn(SCOPE, requestId, 'Gemini call failed', { ms: Date.now() - startedAt, error: String(err) });
    }
  } else {
    logEvent(SCOPE, requestId, 'Gemini skipped — GEMINI_API_KEY not configured');
  }

  if (process.env.OPENAI_API_KEY) {
    const startedAt = Date.now();
    try {
      const openaiResult = await identifyWithOpenAI(resized, requestId);
      logEvent(SCOPE, requestId, 'OpenAI call complete', {
        ms: Date.now() - startedAt,
        isAlbumCover: openaiResult.isAlbumCover,
        resultCount: openaiResult.guesses.length,
        top: openaiResult.guesses[0],
      });
      if (!openaiResult.isAlbumCover || openaiResult.guesses.length > 0) return openaiResult;
    } catch (err) {
      logWarn(SCOPE, requestId, 'OpenAI call failed', { ms: Date.now() - startedAt, error: String(err) });
    }
  } else {
    logEvent(SCOPE, requestId, 'OpenAI skipped — OPENAI_API_KEY not configured');
  }

  logEvent(SCOPE, requestId, 'No provider produced a usable result');
  return ambiguous;
}
