import { Jimp } from 'jimp';

/**
 * Computes a difference hash (dHash) for an image buffer.
 *
 * The algorithm:
 *  1. Convert to greyscale
 *  2. Resize to 9×8 pixels
 *  3. For each of the 8 rows, compare each of the 8 adjacent pixel pairs
 *  4. Bit = 1 when the left pixel is brighter than the right; 0 otherwise
 *
 * Returns a 16-character lowercase hex string representing 64 bits.
 */
export async function computeHash(imageBuffer: Buffer): Promise<string> {
  const image = await Jimp.fromBuffer(imageBuffer);
  // Resize to 9×8 (9 cols so we get 8 horizontal comparisons per row)
  image.resize({ w: 9, h: 8 });
  image.greyscale();

  let bits = '';
  const { data, width } = image.bitmap;

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const leftIdx = (y * width + x) * 4;
      const rightIdx = (y * width + x + 1) * 4;
      // After greyscale the R, G, B channels are equal; use R
      const left = data[leftIdx] ?? 0;
      const right = data[rightIdx] ?? 0;
      bits += left > right ? '1' : '0';
    }
  }

  // Convert 64-bit binary string → 16-char hex
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/**
 * Counts the number of differing bits between two 16-char hex hash strings.
 * Returns Infinity if the hashes have different lengths.
 */
export function hammingDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) return Infinity;
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    let xor = parseInt(hash1[i]!, 16) ^ parseInt(hash2[i]!, 16);
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

/**
 * Returns true when two hash strings are within `threshold` differing bits
 * (default: 15, which tolerates reasonable lighting / angle variation).
 */
export function isMatch(hash1: string, hash2: string, threshold = 15): boolean {
  return hammingDistance(hash1, hash2) <= threshold;
}
