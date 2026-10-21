import { mkdir, realpath, rm, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { contentTypeFor, DEFAULT_CONTENT_TYPE } from "./content-types";
import { assertKey, InvalidKeyError, keyUrl } from "./keys";
import type { PublicStorage } from "./types";
import { assertPublicBaseUrl } from "./urls";

export interface DiskStorageOptions {
  /** The directory objects are written under. Created on first `put`. */
  dir: string;
  /**
   * Where the app serves `dir` from: a path on its own origin (the default,
   * `/storage`, matching `createStorageHandler`'s default prefix) or an
   * absolute URL when another app serves it.
   */
  publicBaseUrl?: string;
  /** Read for `NODE_ENV`. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

const NOT_FOUND = new Set(["ENOENT", "ENOTDIR", "EISDIR"]);

const isNotFound = (error: unknown): boolean =>
  NOT_FOUND.has((error as { code?: string } | null)?.code ?? "");

/**
 * A directory on local disk, so development and tests need no bucket. Refused
 * under `NODE_ENV=production`: a container's disk is gone on the next deploy,
 * and each instance would have its own.
 *
 * A key is held to `assertKey` first, then the resolved path (and, once it
 * exists, its real path, so a symlink cannot point outside either) must stay
 * inside `dir`.
 */
export const createDiskStorage = (
  options: DiskStorageOptions,
): PublicStorage => {
  const env = options.env ?? process.env;
  if (env.NODE_ENV === "production") {
    throw new Error(
      "The disk storage driver is for development and tests only; configure S3 in production.",
    );
  }
  const root = resolve(options.dir);
  const publicBaseUrl = assertPublicBaseUrl(
    options.publicBaseUrl ?? "/storage",
    "publicBaseUrl",
  );

  const inside = (base: string, target: string): boolean =>
    target.startsWith(`${base}${sep}`);

  const pathFor = (key: string): string => {
    const target = resolve(root, assertKey(key));
    if (!inside(root, target)) {
      throw new InvalidKeyError(key, "escapes the storage directory");
    }
    return target;
  };

  // The real path of something that exists, checked against the real root.
  const assertReal = async (key: string, path: string): Promise<string> => {
    const [realRoot, real] = await Promise.all([
      realpath(root),
      realpath(path),
    ]);
    if (real !== realRoot && !inside(realRoot, real)) {
      throw new InvalidKeyError(key, "escapes the storage directory");
    }
    return real;
  };

  return {
    async put(key, body) {
      const target = pathFor(key);
      await mkdir(dirname(target), { recursive: true });
      await assertReal(key, dirname(target));
      await Bun.write(target, body);
    },
    async get(key) {
      const target = pathFor(key);
      let real: string;
      try {
        real = await assertReal(key, target);
        if (!(await stat(real)).isFile()) return null;
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
      const file = Bun.file(real);
      return {
        key,
        size: file.size,
        contentType: contentTypeFor(key) ?? DEFAULT_CONTENT_TYPE,
        stream: () => file.stream(),
        bytes: () => file.bytes(),
        text: () => file.text(),
      };
    },
    async delete(key) {
      const target = pathFor(key);
      try {
        await assertReal(key, target);
      } catch (error) {
        if (isNotFound(error)) return;
        throw error;
      }
      await rm(target, { force: true });
    },
    publicUrl(key) {
      return keyUrl(publicBaseUrl, key);
    },
  };
};
