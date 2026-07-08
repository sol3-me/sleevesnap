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
const GEMINI_MODEL = 'gemini-2.5-flash';
const OPENAI_MODEL = 'gpt-5.4-nano';
const REQUEST_TIMEOUT_MS = 10000;
const SCOPE = 'vision';

const PROMPT =
  'Identify the single vinyl record sleeve shown in this photo. Respond with the ' +
  "artist name, album title, and your confidence (0 to 1) that the identification " +
  'is correct. If you can also determine the release year or genre, include them. ' +
  'Ignore any background objects — there is exactly one record sleeve to identify.';

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    artist: { type: 'string' },
    title: { type: 'string' },
    year: { type: 'string' },
    genre: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['artist', 'title', 'confidence'],
};

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

/** Parses a provider's raw JSON-string reply into a VisionScanResult, or null if malformed. */
function parseResult(raw: string | undefined, requestId: string, provider: string): VisionScanResult | null {
  if (!raw) {
    logWarn(SCOPE, requestId, `${provider} returned an empty response body`);
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<VisionScanResult>;
    if (typeof parsed.artist !== 'string' || typeof parsed.title !== 'string') {
      logWarn(SCOPE, requestId, `${provider} response was missing required fields`, {
        raw: raw.slice(0, 300),
      });
      return null;
    }
    return {
      artist: parsed.artist,
      title: parsed.title,
      year: typeof parsed.year === 'string' ? parsed.year : undefined,
      genre: typeof parsed.genre === 'string' ? parsed.genre : undefined,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    };
  } catch {
    logWarn(SCOPE, requestId, `${provider} response was not valid JSON`, { raw: raw.slice(0, 300) });
    return null;
  }
}

async function identifyWithGemini(imageBuffer: Buffer, requestId: string): Promise<VisionScanResult[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return [];

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
            { text: PROMPT },
            { inlineData: { mimeType: 'image/jpeg', data: imageBuffer.toString('base64') } },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESULT_SCHEMA,
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
  const result = parseResult(data.candidates?.[0]?.content?.parts?.[0]?.text, requestId, 'Gemini');
  return result ? [result] : [];
}

async function identifyWithOpenAI(imageBuffer: Buffer, requestId: string): Promise<VisionScanResult[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

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
            { type: 'text', text: PROMPT },
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
        json_schema: { name: 'vinyl_identification', schema: RESULT_SCHEMA },
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
  const result = parseResult(data.choices?.[0]?.message?.content, requestId, 'OpenAI');
  return result ? [result] : [];
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
