import fs from 'fs';
import path from 'path';
import type { BlobStorageProvider } from './BlobStorageProvider.js';

/**
 * Stores blobs as files on the local filesystem and makes them accessible
 * via a static-file route served by Express.
 *
 * Environment variables:
 *   STORAGE_LOCAL_PATH  – directory to store files in (default: /data/covers)
 *   PUBLIC_URL          – optional base URL of the server (when omitted,
 *                         returned cover URLs are relative, e.g. /covers/...)
 */
export class LocalFileSystemProvider implements BlobStorageProvider {
  private readonly storagePath: string;
  private readonly publicBaseUrl: string | null;

  constructor() {
    this.storagePath = process.env.STORAGE_LOCAL_PATH ?? path.join(process.cwd(), 'data', 'covers');
    const configuredPublicUrl = (process.env.PUBLIC_URL ?? '').trim().replace(/\/$/, '');
    this.publicBaseUrl = configuredPublicUrl || null;
    fs.mkdirSync(this.storagePath, { recursive: true });
  }

  async put(key: string, data: Buffer, _contentType: string): Promise<string> {
    const filePath = path.join(this.storagePath, key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data);
    return this.publicBaseUrl ? `${this.publicBaseUrl}/covers/${key}` : `/covers/${key}`;
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
