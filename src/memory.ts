import { contentTypeFor, DEFAULT_CONTENT_TYPE } from "./content-types";
import { assertKey, keyUrl } from "./keys";
import type { PublicStorage, StorageBody, StoredFile } from "./types";
import { assertPublicBaseUrl } from "./urls";

export interface MemoryObject {
  body: Uint8Array;
  contentType: string;
}

export interface MemoryStorage extends PublicStorage {
  /** Every stored object, by key, for a test to assert on. */
  readonly objects: Map<string, MemoryObject>;
}

export const toBytes = async (body: StorageBody): Promise<Uint8Array> => {
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  return body.slice();
};

export const fileFrom = (
  key: string,
  body: Uint8Array,
  contentType: string,
): StoredFile => ({
  key,
  size: body.length,
  contentType,
  stream: () => new Blob([body as Uint8Array<ArrayBuffer>]).stream(),
  bytes: async () => body.slice(),
  text: async () => new TextDecoder().decode(body),
});

/**
 * A store held in a `Map`, for tests. Nothing touches the disk or the network,
 * and `objects` shows exactly what was written under which key.
 */
export const createMemoryStorage = (
  options: { publicBaseUrl?: string } = {},
): MemoryStorage => {
  const publicBaseUrl = assertPublicBaseUrl(
    options.publicBaseUrl ?? "https://storage.test",
    "publicBaseUrl",
  );
  const objects = new Map<string, MemoryObject>();
  return {
    objects,
    async put(key, body, contentType) {
      assertKey(key);
      objects.set(key, {
        body: await toBytes(body),
        contentType: contentType ?? contentTypeFor(key) ?? DEFAULT_CONTENT_TYPE,
      });
    },
    async get(key) {
      const object = objects.get(assertKey(key));
      return object
        ? fileFrom(key, object.body.slice(), object.contentType)
        : null;
    },
    async delete(key) {
      objects.delete(assertKey(key));
    },
    publicUrl(key) {
      return keyUrl(publicBaseUrl, key);
    },
  };
};
