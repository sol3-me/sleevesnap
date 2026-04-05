/**
 * Abstract interface for blob storage. Implementations can be swapped
 * transparently by setting the STORAGE_PROVIDER environment variable.
 */
export interface BlobStorageProvider {
  /** Store a blob and return its publicly accessible URL. */
  put(key: string, data: Buffer, contentType: string): Promise<string>;

  /** Retrieve a blob by key, or null if it does not exist. */
  get(key: string): Promise<Buffer | null>;

  /** Check whether a blob exists for the given key. */
  exists(key: string): Promise<boolean>;

  /** Remove a blob. Resolves silently if the key does not exist. */
  delete(key: string): Promise<void>;
}
