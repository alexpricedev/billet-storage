import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StorageConfigError, s3ConfigFromEnv, storageFromEnv } from "../src";

const S3 = {
  S3_BUCKET: "bucket",
  S3_ACCESS_KEY_ID: "test-key-id",
  S3_SECRET_ACCESS_KEY: "test-secret",
};

let dir: string;
let warnings: string[];
const warn = (message: string) => warnings.push(message);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "billet-storage-env-"));
  warnings = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// A disk store answers put/get on the local directory; an S3 store would try
// the network, so the rules are told apart by what `publicUrl` reports and by
// where a put lands.
const lands = async (env: Record<string, string>) => {
  const storage = storageFromEnv(env, { warn });
  await storage.put("probe.txt", "x");
  return Bun.file(join(dir, "probe.txt")).exists();
};

describe("storageFromEnv", () => {
  test("S3 when its three variables are set", () => {
    const storage = storageFromEnv(
      { ...S3, STORAGE_PUBLIC_BASE_URL: "https://bucket.example" },
      { warn },
    );
    expect(storage.publicUrl("a.png")).toBe("https://bucket.example/a.png");
    expect(warnings).toEqual([]);
  });

  test("S3 in production", () => {
    const storage = storageFromEnv({ ...S3, NODE_ENV: "production" }, { warn });
    expect(storage.publicUrl("a.png")).toBeNull();
  });

  test("disk at STORAGE_DIR when S3 is not set and not in production", async () => {
    expect(await lands({ STORAGE_DIR: dir })).toBe(true);
    expect(await lands({ STORAGE_DIR: dir, NODE_ENV: "test" })).toBe(true);
    expect(await lands({ STORAGE_DIR: dir, NODE_ENV: "development" })).toBe(
      true,
    );
  });

  test("disk defaults to .storage, served from /storage", () => {
    const storage = storageFromEnv({}, { warn });
    expect(storage.publicUrl("a.png")).toBe("/storage/a.png");
  });

  test("disk uses STORAGE_PUBLIC_BASE_URL when set", () => {
    const storage = storageFromEnv(
      {
        STORAGE_DIR: dir,
        STORAGE_PUBLIC_BASE_URL: "http://localhost:3001/files",
      },
      { warn },
    );
    expect(storage.publicUrl("a.png")).toBe(
      "http://localhost:3001/files/a.png",
    );
  });

  test("production without S3 is refused, naming the missing variables", () => {
    expect(() => storageFromEnv({ NODE_ENV: "production" }, { warn })).toThrow(
      StorageConfigError,
    );
    expect(() => storageFromEnv({ NODE_ENV: "production" }, { warn })).toThrow(
      /S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY/,
    );
  });

  test("production never falls back to disk, even with STORAGE_DIR set", async () => {
    expect(() =>
      storageFromEnv({ NODE_ENV: "production", STORAGE_DIR: dir }, { warn }),
    ).toThrow(/STORAGE_DIR is ignored in production/);
    expect(await Bun.file(join(dir, "probe.txt")).exists()).toBe(false);
  });

  test("STORAGE_DIR is ignored with a warning when S3 is set in production", () => {
    const storage = storageFromEnv(
      { ...S3, NODE_ENV: "production", STORAGE_DIR: dir },
      { warn },
    );
    expect(storage.publicUrl("a.png")).toBeNull();
    expect(warnings).toEqual([
      "STORAGE_DIR is for development and tests only; ignoring it in production and using S3.",
    ]);
  });

  test("S3 wins over STORAGE_DIR in development too, with a warning", () => {
    storageFromEnv({ ...S3, STORAGE_DIR: dir }, { warn });
    expect(warnings).toEqual([
      "STORAGE_DIR is ignored because S3 is configured.",
    ]);
  });

  test("partial S3 config throws, naming what is missing, in any environment", () => {
    for (const NODE_ENV of ["production", "development"]) {
      expect(() =>
        storageFromEnv({ NODE_ENV, S3_BUCKET: "bucket" }, { warn }),
      ).toThrow(/set S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY as well/);
    }
  });

  test("blank values count as unset", async () => {
    expect(
      await lands({ STORAGE_DIR: dir, S3_BUCKET: "  ", S3_ACCESS_KEY_ID: "" }),
    ).toBe(true);
  });

  test("an invalid STORAGE_PUBLIC_BASE_URL is refused", () => {
    expect(() =>
      storageFromEnv(
        { ...S3, STORAGE_PUBLIC_BASE_URL: "javascript:alert(1)" },
        { warn },
      ),
    ).toThrow(/publicBaseUrl/);
    expect(() =>
      storageFromEnv({ STORAGE_PUBLIC_BASE_URL: "bucket.example" }, { warn }),
    ).toThrow(/publicBaseUrl/);
  });

  test("the error never includes a credential", () => {
    try {
      storageFromEnv(
        { NODE_ENV: "production", S3_SECRET_ACCESS_KEY: "super-secret-value" },
        { warn },
      );
      throw new Error("expected a refusal");
    } catch (error) {
      expect(String(error)).not.toInclude("super-secret-value");
    }
  });
});

describe("s3ConfigFromEnv", () => {
  test("null when none of the required variables is set", () => {
    expect(s3ConfigFromEnv({ S3_REGION: "eu-west-2" })).toBeNull();
  });

  test("reads the optional variables, trimmed", () => {
    expect(
      s3ConfigFromEnv({
        ...S3,
        S3_REGION: " auto ",
        S3_ENDPOINT: "https://s3.provider.example",
        S3_SESSION_TOKEN: "session",
        STORAGE_PUBLIC_BASE_URL: "https://bucket.example",
      }),
    ).toEqual({
      ...{
        bucket: "bucket",
        accessKeyId: "test-key-id",
        secretAccessKey: "test-secret",
      },
      region: "auto",
      endpoint: "https://s3.provider.example",
      sessionToken: "session",
      publicBaseUrl: "https://bucket.example",
    });
  });

  test("never reads AWS_* variables", () => {
    expect(
      s3ConfigFromEnv({
        AWS_ACCESS_KEY_ID: "aws",
        AWS_SECRET_ACCESS_KEY: "aws",
      }),
    ).toBeNull();
  });
});
