import { Router } from 'express';
import { GoogleGenAI, Type } from '@google/genai';

export const searchRouter = Router();

// POST /api/search  – proxy text-based vinyl search to Gemini on the server side
searchRouter.post('/', async (req, res) => {
  const { query } = req.body;

  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: 'query is required' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server' });
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-04-17',
      contents: `Search for vinyl records matching the query: "${query}".
Return a list of up to 5 plausible matches.
For each match, provide: artist, title, year, genre, and a placeholder description.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              artist: { type: Type.STRING },
              title: { type: Type.STRING },
              year: { type: Type.STRING },
              genre: { type: Type.STRING },
              description: { type: Type.STRING },
            },
          },
        },
      },
    });

    if (!response.text) {
      res.json([]);
      return;
    }

    const raw: Array<{
      artist: string;
      title: string;
      year?: string;
      genre?: string;
      description?: string;
    }> = JSON.parse(response.text);

    const results = raw.map((item, index) => ({
      id: `search-${Date.now()}-${index}`,
      artist: item.artist,
      title: item.title,
      year: item.year,
      genre: item.genre,
      dateAdded: Date.now(),
      coverUrl: `https://picsum.photos/seed/${encodeURIComponent(item.title + item.artist)}/300/300`,
      notes: item.description,
    }));

    res.json(results);
  } catch (err) {
    console.error('[search] Gemini error:', err);
    res.status(502).json({ error: 'Failed to search records' });
  }
});
