import { Jimp } from 'jimp';

/**
 * Produces a small, web-optimized JPEG thumbnail of an image buffer, used
 * for the landing wall where covers render at ~150px. Downscales to at most
 * `size` px wide (never upscales a smaller source) and re-encodes as JPEG so
 * a full pool of covers is a couple of MB total instead of tens.
 */
export async function createThumbnail(buffer: Buffer, size = 256, quality = 72): Promise<Buffer> {
  const image = await Jimp.fromBuffer(buffer);
  if (image.bitmap.width > size) {
    image.resize({ w: size });
  }
  return image.getBuffer('image/jpeg', { quality });
}
