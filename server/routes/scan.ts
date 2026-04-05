import { Router } from 'express';
import { GoogleGenAI, Type } from '@google/genai';

export const scanRouter = Router();

// POST /api/scan  – proxy image-analysis to Gemini on the server side
scanRouter.post('/', async (req, res) => {
  const { base64Image } = req.body;

  if (!base64Image || typeof base64Image !== 'string') {
    res.status(400).json({ error: 'base64Image is required' });
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
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: base64Image,
            },
          },
          {
            text: `Analyze this image and identify any vinyl record covers visible.
Return a JSON array where each object has: 'artist', 'title', 'year' (if visible/known), 'genre' (best guess), and 'confidence' (0-1).
If multiple records are visible, list them all. If no records are clearly visible, return an empty array.`,
          },
        ],
      },
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
              confidence: { type: Type.NUMBER },
            },
            required: ['artist', 'title', 'confidence'],
          },
        },
      },
    });

    const results = response.text ? JSON.parse(response.text) : [];
    res.json(results);
  } catch (err) {
    console.error('[scan] Gemini error:', err);
    res.status(502).json({ error: 'Failed to analyse image' });
  }
});
