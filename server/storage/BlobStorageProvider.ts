/**
 * Abstract interface for blob storage, kept as a seam so a future provider
 * (e.g. Firebase Storage) can be swapped in without touching callers.
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
