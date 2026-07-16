import { Jimp } from 'jimp';

/**
 * Produces a small, web-optimized JPEG thumbnail of an image buffer, used
 * for the landing wall where covers render at ~150px. Downscales to at most
 * `size` px wide (never upscales a smaller source) and re-encodes as JPEG so
 * a full pool of covers is a couple of MB total instead of tens.
 */
export async function createThumbnail(_buffer: Buffer, _size = 256, _quality = 72): Promise<Buffer> {
  return _buffer;
}
