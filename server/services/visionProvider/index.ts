import { Jimp } from 'jimp';

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
function parseResult(raw: string | undefined): VisionScanResult | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<VisionScanResult>;
    if (typeof parsed.artist !== 'string' || typeof parsed.title !== 'string') {
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
    return null;
  }
}

async function identifyWithGemini(imageBuffer: Buffer): Promise<VisionScanResult[]> {
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
    throw new Error(`Gemini vision request failed (${res.status})`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const result = parseResult(data.candidates?.[0]?.content?.parts?.[0]?.text);
  return result ? [result] : [];
}

async function identifyWithOpenAI(imageBuffer: Buffer): Promise<VisionScanResult[]> {
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
    throw new Error(`OpenAI vision request failed (${res.status})`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const result = parseResult(data.choices?.[0]?.message?.content);
  return result ? [result] : [];
}

/**
 * Identifies the single vinyl sleeve in `imageBuffer` using an AI vision
 * provider. Tries Gemini first, falls back to OpenAI on any failure. Never
 * throws — returns [] when both providers fail or neither API key is
 * configured, so callers can treat this as a plain "no suggestion" signal.
 *
 * NOTE: Gemini's exact request/response envelope below is based on the
 * long-documented `generateContent` REST shape (contents/parts/inlineData,
 * generationConfig.responseSchema). This could not be reliably re-confirmed
 * against live docs during design — verify against
 * https://ai.google.dev/gemini-api/docs/image-understanding if calls start
 * failing unexpectedly.
 */
export async function identifyVinyl(imageBuffer: Buffer): Promise<VisionScanResult[]> {
  let resized: Buffer;
  try {
    resized = await resizeForVision(imageBuffer);
  } catch (err) {
    console.warn('[vision] Failed to resize image for vision providers:', err);
    return [];
  }

  try {
    const geminiResults = await identifyWithGemini(resized);
    if (geminiResults.length > 0) return geminiResults;
  } catch (err) {
    console.warn('[vision] Gemini identification failed:', err);
  }

  try {
    const openaiResults = await identifyWithOpenAI(resized);
    if (openaiResults.length > 0) return openaiResults;
  } catch (err) {
    console.warn('[vision] OpenAI identification failed:', err);
  }

  return [];
}
