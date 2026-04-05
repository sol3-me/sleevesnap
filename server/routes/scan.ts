import { Router } from 'express';

export const scanRouter = Router();

interface ScanResult {
  artist: string;
  title: string;
  year?: string;
  genre?: string;
  confidence: number;
}
/**
 * Parses a JSON array of scan results from an LLM text response.
 * Handles cases where the model wraps the array in a markdown code block
 * or a JSON object wrapper.
 */
function parseScanResults(text: string): ScanResult[] {
  // Strip markdown code fences if present
  const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    // Try extracting the first JSON array or object from the text
    const arrayMatch = stripped.match(/\[[\s\S]*\]/);
    const objMatch = stripped.match(/\{[\s\S]*\}/);
    const raw = arrayMatch?.[0] ?? objMatch?.[0];
    if (!raw) return [];
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }

  // Accept either a bare array or { results: [...] }
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown>)?.results)
      ? (parsed as Record<string, unknown[]>).results
      : [];

  return arr
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      artist: String(item.artist ?? ''),
      title: String(item.title ?? ''),
      year: item.year != null ? String(item.year) : undefined,
      genre: item.genre != null ? String(item.genre) : undefined,
      confidence: typeof item.confidence === 'number' ? item.confidence : 0.5,
    }))
    .filter((r) => r.artist && r.title);
}

// POST /api/scan  – identify vinyl records in an image via a local vision model
scanRouter.post('/', async (req, res) => {
  const { base64Image } = req.body;

  if (!base64Image || typeof base64Image !== 'string') {
    res.status(400).json({ error: 'base64Image is required' });
    return;
  }

  const baseUrl = (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(/\/$/, '');
  const model = process.env.VISION_MODEL ?? 'llava';

  const prompt =
    'Analyze this image and identify any vinyl record covers visible. ' +
    'Return a JSON object with a "results" key containing an array where each element has: ' +
    '"artist" (string), "title" (string), "year" (string, if known), "genre" (string, best guess), "confidence" (number 0-1). ' +
    'If no records are clearly visible, return {"results": []}. ' +
    'Respond with JSON only, no other text.';

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${base64Image}` },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        stream: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('[scan] Vision model error:', response.status, body);
      res.status(502).json({ error: 'Vision model request failed', detail: body });
      return;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const text = data.choices?.[0]?.message?.content ?? '';
    const results = parseScanResults(text);
    res.json(results);
  } catch (err) {
    console.error('[scan] Error calling vision model:', err);
    res.status(502).json({ error: 'Failed to analyse image' });
  }
});

