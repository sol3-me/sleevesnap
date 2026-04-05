import type { BlobStorageProvider } from './BlobStorageProvider.js';
import { LocalFileSystemProvider } from './LocalFileSystemProvider.js';
import { S3Provider } from './S3Provider.js';

/**
 * Create and return a BlobStorageProvider based on the STORAGE_PROVIDER
 * environment variable.
 *
 *   STORAGE_PROVIDER=local  (default) → LocalFileSystemProvider
 *   STORAGE_PROVIDER=s3              → S3Provider (MinIO / AWS S3 / R2)
 */
export function createStorageProvider(): BlobStorageProvider {
  const providerName = (process.env.STORAGE_PROVIDER ?? 'local').toLowerCase();

  switch (providerName) {
    case 's3':
      console.log('[storage] Using S3-compatible provider');
      return new S3Provider();
    case 'local':
    default:
      console.log('[storage] Using local filesystem provider');
      return new LocalFileSystemProvider();
  }
}

export type { BlobStorageProvider } from './BlobStorageProvider.js';
