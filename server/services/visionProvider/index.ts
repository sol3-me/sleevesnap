export interface VisionScanResult {
  artist: string;
  title: string;
  year?: string;
  genre?: string;
  confidence: number;
}

/**
 * Identifies the single vinyl sleeve in `imageBuffer` using an AI vision
 * provider. Tries Gemini first, falls back to OpenAI on any failure. Never
 * throws — returns [] when both providers fail or neither API key is
 * configured, so callers can treat this as a plain "no suggestion" signal.
 *
 * TODO: stub — always returns []. Real implementation lands in the
 * implementation commit.
 */
export async function identifyVinyl(_imageBuffer: Buffer): Promise<VisionScanResult[]> {
  return [];
}
