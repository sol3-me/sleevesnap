import fs from 'fs';
import path from 'path';
import type { BlobStorageProvider } from './BlobStorageProvider.js';

/**
 * Stores blobs as files on the local filesystem and makes them accessible
 * via a static-file route served by Express.
 *
 * Environment variables:
 *   STORAGE_LOCAL_PATH  – directory to store files in (default: /data/covers)
 *   PUBLIC_URL          – base URL of the server (default: http://localhost:3001)
 */
export class LocalFileSystemProvider implements BlobStorageProvider {
  private readonly storagePath: string;
  private readonly publicBaseUrl: string;

  constructor() {
    this.storagePath = process.env.STORAGE_LOCAL_PATH ?? '/data/covers';
    this.publicBaseUrl = (process.env.PUBLIC_URL ?? 'http://localhost:3001').replace(/\/$/, '');
    fs.mkdirSync(this.storagePath, { recursive: true });
  }

  async put(key: string, data: Buffer, _contentType: string): Promise<string> {
    const filePath = path.join(this.storagePath, key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data);
    return `${this.publicBaseUrl}/covers/${key}`;
  }

  async get(key: string): Promise<Buffer | null> {
    const filePath = path.join(this.storagePath, key);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(path.join(this.storagePath, key));
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(this.storagePath, key);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}
