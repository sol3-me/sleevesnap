import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import type { BlobStorageProvider } from './BlobStorageProvider.js';

/**
 * Stores blobs in any S3-compatible object store (AWS S3, MinIO, Cloudflare R2, etc.).
 *
 * Environment variables:
 *   S3_ENDPOINT    – custom endpoint URL (e.g. http://minio:9000 for MinIO)
 *   S3_REGION      – AWS region (default: us-east-1)
 *   S3_BUCKET      – bucket name (default: sleevesnap-covers)
 *   S3_ACCESS_KEY  – access key id
 *   S3_SECRET_KEY  – secret access key
 *   S3_PUBLIC_URL  – override for the public base URL of stored objects
 *                    (useful when MinIO sits behind a proxy)
 */
export class S3Provider implements BlobStorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT;
    this.bucket = process.env.S3_BUCKET ?? 'sleevesnap-covers';

    const accessKeyId = process.env.S3_ACCESS_KEY;
    const secretAccessKey = process.env.S3_SECRET_KEY;

    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        '[S3Provider] S3_ACCESS_KEY and S3_SECRET_KEY must be set when STORAGE_PROVIDER=s3',
      );
    }

    this.client = new S3Client({
      region: process.env.S3_REGION ?? 'us-east-1',
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      credentials: { accessKeyId, secretAccessKey },
    });

    // Public URL for objects: use explicit override, endpoint, or AWS style
    const base = process.env.S3_PUBLIC_URL ?? endpoint ?? `https://${this.bucket}.s3.amazonaws.com`;
    this.publicBaseUrl = base.replace(/\/$/, '');
  }

  async put(key: string, data: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
    const endpoint = process.env.S3_ENDPOINT;
    if (endpoint) {
      // Path-style URL for MinIO and other self-hosted stores
      return `${this.publicBaseUrl}/${this.bucket}/${key}`;
    }
    return `${this.publicBaseUrl}/${key}`;
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!response.Body) return null;
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as Readable) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch {
      // Silently ignore missing-key errors
    }
  }
}
