import type { BlobStorageProvider } from './BlobStorageProvider.js';
import { LocalFileSystemProvider } from './LocalFileSystemProvider.js';

/**
 * Create the blob storage provider. Local filesystem only for now —
 * sleevesnap runs self-hosted via Docker, so cover-art blobs are written to
 * a Docker volume. The BlobStorageProvider interface exists as a seam for a
 * future provider (e.g. Firebase Storage) when the app migrates off
 * self-hosted infrastructure.
 */
export function createStorageProvider(): BlobStorageProvider {
  return new LocalFileSystemProvider();
}

export type { BlobStorageProvider } from './BlobStorageProvider.js';
