/** What `put` accepts. A `Blob` covers `Bun.file(...)` and an uploaded `File`. */
export type StorageBody = Uint8Array | ArrayBuffer | Blob | string;

/** One stored object, as `get` returns it. The bytes are read on demand. */
export interface StoredFile {
  key: string;
  /** Size in bytes. */
  size: number;
  /**
   * The type the object was stored with (S3 and memory), or the one its
   * extension implies (disk, which keeps no metadata).
   */
  contentType: string;
  stream(): ReadableStream<Uint8Array>;
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
}

export interface Storage {
  /**
   * Store `body` under `key`, overwriting anything already there.
   * `contentType` defaults to the type the key's extension implies
   * (`contentTypeFor`), else `application/octet-stream`.
   */
  put(key: string, body: StorageBody, contentType?: string): Promise<void>;
  /** The object under `key`, or `null` when there is none. */
  get(key: string): Promise<StoredFile | null>;
  /** Remove `key`. A missing key is not an error. */
  delete(key: string): Promise<void>;
  /**
   * The URL a page renders for `key`, or `null` when the store has no public
   * URL (a private bucket, served back through your own route).
   */
  publicUrl(key: string): string | null;
}

/** A store that always has a public URL: disk, memory, and S3 given one. */
export interface PublicStorage extends Storage {
  publicUrl(key: string): string;
}
