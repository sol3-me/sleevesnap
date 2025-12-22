import { GoogleGenAI, Type } from "@google/genai";
import { ScanResult, VinylRecord } from '../types';

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Analyzes an image to identify vinyl records.
 * Uses gemini-2.5-flash-image for efficient vision capabilities.
 */
export const identifyVinylsFromImage = async (base64Image: string): Promise<ScanResult[]> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: base64Image
            }
          },
          {
            text: `Analyze this image and identify any vinyl record covers visible. 
            Return a JSON array where each object has: 'artist', 'title', 'year' (if visible/known), 'genre' (best guess), and 'confidence' (0-1).
            If multiple records are visible, list them all. If no records are clearly visible, return an empty array.`
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              artist: { type: Type.STRING },
              title: { type: Type.STRING },
              year: { type: Type.STRING },
              genre: { type: Type.STRING },
              confidence: { type: Type.NUMBER }
            },
            required: ['artist', 'title', 'confidence']
          }
        }
      }
    });

    if (response.text) {
      return JSON.parse(response.text) as ScanResult[];
    }
    return [];
  } catch (error) {
    console.error("Gemini Scan Error:", error);
    throw new Error("Failed to identify vinyls.");
  }
};

/**
 * Simulates a database search by asking Gemini to find record details.
 * Uses gemini-3-flash-preview for text capabilities.
 */
export const searchVinylDatabase = async (query: string): Promise<VinylRecord[]> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Search for vinyl records matching the query: "${query}". 
      Return a list of up to 5 plausible matches. 
      For each match, provide: artist, title, year, genre, and a placeholder description.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              artist: { type: Type.STRING },
              title: { type: Type.STRING },
              year: { type: Type.STRING },
              genre: { type: Type.STRING },
              description: { type: Type.STRING }
            }
          }
        }
      }
    });

    if (response.text) {
      const results = JSON.parse(response.text);
      // Map to VinylRecord type, generating IDs and mock cover URLs
      return results.map((res: any, index: number) => ({
        id: `search-${Date.now()}-${index}`,
        artist: res.artist,
        title: res.title,
        year: res.year,
        genre: res.genre,
        dateAdded: Date.now(),
        // We use a picsum image as a placeholder since we can't reliably get real cover URLs without a paid/CORS-heavy API
        coverUrl: `https://picsum.photos/seed/${encodeURIComponent(res.title + res.artist)}/300/300`,
        notes: res.description
      }));
    }
    return [];
  } catch (error) {
    console.error("Gemini Search Error:", error);
    return [];
  }
};