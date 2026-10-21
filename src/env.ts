import { createDiskStorage } from "./disk";
import { createS3Storage, type S3StorageConfig } from "./s3";
import type { Storage } from "./types";

type Env = Record<string, string | undefined>;

/** Required, all three together, for the S3 driver. */
export const S3_REQUIRED_VARS = [
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

/** Thrown when the environment cannot produce a store. */
export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConfigError";
  }
}

const value = (env: Env, name: string): string | undefined => {
  const trimmed = env[name]?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * The S3 config the environment describes, or `null` when none of the
 * required variables is set. Some but not all of them is a mistake rather than
 * "no bucket", so it throws, naming the ones missing.
 */
export const s3ConfigFromEnv = (
  env: Env = process.env,
): S3StorageConfig | null => {
  const missing = S3_REQUIRED_VARS.filter((name) => !value(env, name));
  if (missing.length === S3_REQUIRED_VARS.length) return null;
  if (missing.length > 0) {
    throw new StorageConfigError(
      `S3 storage is partly configured: set ${missing.join(", ")} as well, or unset the rest.`,
    );
  }
  const optional = (name: string) => value(env, name);
  const region = optional("S3_REGION");
  const endpoint = optional("S3_ENDPOINT");
  const sessionToken = optional("S3_SESSION_TOKEN");
  const publicBaseUrl = optional("STORAGE_PUBLIC_BASE_URL");
  return {
    bucket: value(env, "S3_BUCKET") as string,
    accessKeyId: value(env, "S3_ACCESS_KEY_ID") as string,
    secretAccessKey: value(env, "S3_SECRET_ACCESS_KEY") as string,
    ...(region ? { region } : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(sessionToken ? { sessionToken } : {}),
    ...(publicBaseUrl ? { publicBaseUrl } : {}),
  };
};

export interface StorageFromEnvOptions {
  /** Where configuration warnings go. Default `console.warn`. */
  warn?: (message: string) => void;
}

/**
 * The store the environment asks for:
 *
 * 1. S3, when `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are
 *    all set (some but not all of them throws).
 * 2. Otherwise, outside production, the disk driver at `STORAGE_DIR`
 *    (default `.storage`), served from `STORAGE_PUBLIC_BASE_URL` (default
 *    `/storage`).
 * 3. Otherwise, under `NODE_ENV=production`, a `StorageConfigError` naming the
 *    missing variables. It never falls back to disk in production.
 *
 * `STORAGE_DIR` is ignored, with a warning, whenever S3 is configured or the
 * app is in production.
 */
export const storageFromEnv = (
  env: Env = process.env,
  options: StorageFromEnvOptions = {},
): Storage => {
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const production = env.NODE_ENV === "production";
  const dir = value(env, "STORAGE_DIR");
  const s3 = s3ConfigFromEnv(env);

  if (s3) {
    if (dir) {
      warn(
        production
          ? "STORAGE_DIR is for development and tests only; ignoring it in production and using S3."
          : "STORAGE_DIR is ignored because S3 is configured.",
      );
    }
    return createS3Storage(s3);
  }

  if (production) {
    throw new StorageConfigError(
      `No file storage in production: set ${S3_REQUIRED_VARS.join(", ")}` +
        " (and S3_ENDPOINT, S3_REGION or STORAGE_PUBLIC_BASE_URL as your provider needs)." +
        (dir ? " STORAGE_DIR is ignored in production." : ""),
    );
  }

  const publicBaseUrl = value(env, "STORAGE_PUBLIC_BASE_URL");
  return createDiskStorage({
    dir: dir ?? ".storage",
    ...(publicBaseUrl ? { publicBaseUrl } : {}),
    env,
  });
};
