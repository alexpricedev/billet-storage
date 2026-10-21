import { contentTypeFor, DEFAULT_CONTENT_TYPE } from "./content-types";
import { assertKey, keyUrl } from "./keys";
import type { PublicStorage, Storage, StorageBody } from "./types";
import { assertPublicBaseUrl } from "./urls";

export interface S3StorageConfig {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Optional on AWS when the bucket is in the default region. */
  region?: string;
  /** Set for anything that isn't AWS: R2, MinIO, a Railway bucket. */
  endpoint?: string;
  sessionToken?: string;
  /**
   * The origin objects are publicly served from (a bucket's public URL or a
   * CDN in front of it). Usually not the API endpoint. Leave it out for a
   * private bucket: `publicUrl` then returns `null` and the app streams objects
   * back through its own route with `get`.
   */
  publicBaseUrl?: string;
}

/**
 * The slice of `Bun.S3Client` this driver calls, so a test can hand it a fake
 * instead of a bucket.
 */
export interface S3ClientLike {
  write(
    key: string,
    data: StorageBody,
    options?: { type?: string },
  ): Promise<number>;
  file(key: string): {
    stat(): Promise<{ size: number; type: string }>;
    stream(): ReadableStream<Uint8Array>;
    bytes(): Promise<Uint8Array>;
    text(): Promise<string>;
  };
  unlink(key: string): Promise<void>;
}

// What Bun's client throws for a key that isn't there: an `S3Error` with this
// code, on a HEAD as well as a GET.
const isNoSuchKey = (error: unknown): boolean => {
  const code = (error as { code?: string } | null)?.code;
  return code === "NoSuchKey" || code === "NotFound";
};

/**
 * Every credential is passed to the client explicitly. Left unset, Bun's
 * `S3Options` falls back to `S3_*` and also to `AWS_*` variables, and an
 * unrelated AWS credential in the environment must never become the one this
 * app writes with.
 */
const clientFor = (config: S3StorageConfig): S3ClientLike =>
  new Bun.S3Client({
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    ...(config.region ? { region: config.region } : {}),
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
  });

/** An S3-compatible bucket, through Bun's built-in client. No SDK. */
export function createS3Storage(
  config: S3StorageConfig & { publicBaseUrl: string },
  options?: { client?: S3ClientLike },
): PublicStorage;
export function createS3Storage(
  config: S3StorageConfig,
  options?: { client?: S3ClientLike },
): Storage;
export function createS3Storage(
  config: S3StorageConfig,
  options: { client?: S3ClientLike } = {},
): Storage {
  const publicBaseUrl =
    config.publicBaseUrl === undefined
      ? null
      : assertPublicBaseUrl(config.publicBaseUrl, "publicBaseUrl");
  const client = options.client ?? clientFor(config);

  return {
    async put(key, body, contentType) {
      // Bun's `write` has no per-object Cache-Control, so a long-lived cache
      // header on public objects is a bucket or CDN rule (see the README).
      await client.write(assertKey(key), body, {
        type: contentType ?? contentTypeFor(key) ?? DEFAULT_CONTENT_TYPE,
      });
    },
    async get(key) {
      const file = client.file(assertKey(key));
      let stats: { size: number; type: string };
      try {
        stats = await file.stat();
      } catch (error) {
        if (isNoSuchKey(error)) return null;
        throw error;
      }
      return {
        key,
        size: stats.size,
        contentType: stats.type || DEFAULT_CONTENT_TYPE,
        stream: () => file.stream(),
        bytes: () => file.bytes(),
        text: () => file.text(),
      };
    },
    async delete(key) {
      await client.unlink(assertKey(key));
    },
    publicUrl(key) {
      return publicBaseUrl === null ? null : keyUrl(publicBaseUrl, key);
    },
  };
}
