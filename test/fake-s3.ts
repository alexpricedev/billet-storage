import type { S3ClientLike } from "../src";

/**
 * An in-memory bucket standing in for `Bun.S3Client`. What is worth asserting
 * is what got written under which key and with which type, and a Map is the
 * only way to see that without a network.
 */
export interface FakeBucket extends S3ClientLike {
  objects: Map<string, { body: Uint8Array; type: string }>;
  /** Every call, in order, e.g. `write media/a.png`. */
  calls: string[];
  /** Set to make every call throw this, for the failure paths. */
  failWith: unknown;
}

const noSuchKey = () =>
  Object.assign(new Error("The specified key does not exist."), {
    name: "S3Error",
    code: "NoSuchKey",
  });

const toBytes = async (data: unknown): Promise<Uint8Array> => {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  return (data as Uint8Array).slice();
};

export const fakeS3 = (): FakeBucket => {
  const objects = new Map<string, { body: Uint8Array; type: string }>();
  const bucket: FakeBucket = {
    objects,
    calls: [],
    failWith: null,
    async write(key, data, options) {
      bucket.calls.push(`write ${key}`);
      if (bucket.failWith) throw bucket.failWith;
      const body = await toBytes(data);
      objects.set(key, { body, type: options?.type ?? "" });
      return body.length;
    },
    file(key) {
      const read = () => {
        if (bucket.failWith) throw bucket.failWith;
        const object = objects.get(key);
        if (!object) throw noSuchKey();
        return object;
      };
      return {
        async stat() {
          bucket.calls.push(`stat ${key}`);
          const { body, type } = read();
          return { size: body.length, type };
        },
        stream() {
          return new Blob([read().body as Uint8Array<ArrayBuffer>]).stream();
        },
        async bytes() {
          return read().body.slice();
        },
        async text() {
          return new TextDecoder().decode(read().body);
        },
      };
    },
    async unlink(key) {
      bucket.calls.push(`unlink ${key}`);
      if (bucket.failWith) throw bucket.failWith;
      objects.delete(key);
    },
  };
  return bucket;
};
