import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Jimp } from 'jimp';
import { createThumbnail } from './thumbnail.js';

async function solidJpeg(width: number, height: number): Promise<Buffer> {
  const image = new Jimp({ width, height, color: 0x3366ccff });
  return image.getBuffer('image/jpeg');
}

test('createThumbnail downscales a large image to the target width', async () => {
  const source = await solidJpeg(1000, 1000);
  const thumbBuf = await createThumbnail(source, 256);
  const thumb = await Jimp.fromBuffer(thumbBuf);

  assert.equal(thumb.bitmap.width, 256);
  assert.equal(thumb.bitmap.height, 256);
});

test('createThumbnail preserves aspect ratio for non-square images', async () => {
  const source = await solidJpeg(800, 400);
  const thumb = await Jimp.fromBuffer(await createThumbnail(source, 256));

  assert.equal(thumb.bitmap.width, 256);
  assert.equal(thumb.bitmap.height, 128);
});

test('createThumbnail does not upscale a source smaller than the target', async () => {
  const source = await solidJpeg(120, 120);
  const thumb = await Jimp.fromBuffer(await createThumbnail(source, 256));

  assert.equal(thumb.bitmap.width, 120);
});

test('createThumbnail returns a valid JPEG buffer', async () => {
  const source = await solidJpeg(600, 600);
  const thumbBuf = await createThumbnail(source, 256);

  // JPEG magic bytes.
  assert.equal(thumbBuf[0], 0xff);
  assert.equal(thumbBuf[1], 0xd8);
  assert.ok(thumbBuf.length > 0);
});
