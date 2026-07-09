import { Jimp } from 'jimp';
import { logEvent, logWarn } from '../../logger.js';

export interface VisionScanResult {
  artist: string;
  title: string;
  year?: string;
  genre?: string;
  confidence: number;
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
    'Identify the single vinyl record sleeve shown in this photo. Return a JSON array of candidate guesses, ' +
    `sorted by confidence descending, with at least ${minGuesses} guesses when possible and up to ${maxGuesses} guesses if uncertain. ` +
    "Each guess must include artist name, album title, and confidence (0 to 1). " +
    'If you can determine the release year or genre, include them. Ignore background objects — there is exactly one record sleeve to identify.'
  );
}

function buildResultSchema(minGuesses: number, maxGuesses: number) {
  return {
    type: 'array',
    minItems: minGuesses,
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

/** Parses a provider's raw JSON-string reply into normalized, confidence-sorted guesses. */
function parseResults(raw: string | undefined, requestId: string, provider: string, maxGuesses: number): VisionScanResult[] {
  if (!raw) {
    logWarn(SCOPE, requestId, `${provider} returned an empty response body`);
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Partial<VisionScanResult> | Array<Partial<VisionScanResult>>;
    const candidates = Array.isArray(parsed) ? parsed : [parsed];

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
      logWarn(SCOPE, requestId, `${provider} response was missing required fields`, {
        raw: raw.slice(0, 300),
      });
      return [];
    }

    const deduped = new Map<string, VisionScanResult>();
    for (const candidate of cleaned) {
      const key = `${candidate.artist.toLowerCase()}::${candidate.title.toLowerCase()}`;
      const existing = deduped.get(key);
      if (!existing || candidate.confidence > existing.confidence) {
        deduped.set(key, candidate);
      }
    }

    return Array.from(deduped.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxGuesses);
  } catch {
    logWarn(SCOPE, requestId, `${provider} response was not valid JSON`, { raw: raw.slice(0, 300) });
    return [];
  }
}

async function identifyWithGemini(imageBuffer: Buffer, requestId: string): Promise<VisionScanResult[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return [];
  const { min, max } = getGuessLimits();
  const prompt = buildPrompt(min, max);
  const resultSchema = buildResultSchema(min, max);

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

async function identifyWithOpenAI(imageBuffer: Buffer, requestId: string): Promise<VisionScanResult[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];
  const { min, max } = getGuessLimits();
  const prompt = buildPrompt(min, max);
  const resultSchema = buildResultSchema(min, max);

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
 * provider. Tries Gemini first, falls back to OpenAI on any failure. Never
 * throws — returns [] when both providers fail or neither API key is
 * configured, so callers can treat this as a plain "no suggestion" signal.
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
export async function identifyVinyl(imageBuffer: Buffer, requestId = 'unknown'): Promise<VisionScanResult[]> {
  let resized: Buffer;
  try {
    resized = await resizeForVision(imageBuffer);
    logEvent(SCOPE, requestId, 'Image resized for vision providers', {
      originalBytes: imageBuffer.length,
      resizedBytes: resized.length,
    });
  } catch (err) {
    logWarn(SCOPE, requestId, 'Failed to resize image for vision providers', { error: String(err) });
    return [];
  }

  if (process.env.GEMINI_API_KEY) {
    const startedAt = Date.now();
    try {
      const geminiResults = await identifyWithGemini(resized, requestId);
      logEvent(SCOPE, requestId, 'Gemini call complete', {
        ms: Date.now() - startedAt,
        resultCount: geminiResults.length,
        top: geminiResults[0],
      });
      if (geminiResults.length > 0) return geminiResults;
    } catch (err) {
      logWarn(SCOPE, requestId, 'Gemini call failed', { ms: Date.now() - startedAt, error: String(err) });
    }
  } else {
    logEvent(SCOPE, requestId, 'Gemini skipped — GEMINI_API_KEY not configured');
  }

  if (process.env.OPENAI_API_KEY) {
    const startedAt = Date.now();
    try {
      const openaiResults = await identifyWithOpenAI(resized, requestId);
      logEvent(SCOPE, requestId, 'OpenAI call complete', {
        ms: Date.now() - startedAt,
        resultCount: openaiResults.length,
        top: openaiResults[0],
      });
      if (openaiResults.length > 0) return openaiResults;
    } catch (err) {
      logWarn(SCOPE, requestId, 'OpenAI call failed', { ms: Date.now() - startedAt, error: String(err) });
    }
  } else {
    logEvent(SCOPE, requestId, 'OpenAI skipped — OPENAI_API_KEY not configured');
  }

  logEvent(SCOPE, requestId, 'No provider produced a usable result');
  return [];
}
