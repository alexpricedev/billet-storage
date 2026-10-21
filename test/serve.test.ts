import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDiskStorage,
  createMemoryStorage,
  createStorageHandler,
  type PublicStorage,
} from "../src";

let base: string;
let storage: PublicStorage;
let handler: (req: Request) => Promise<Response | null>;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "billet-storage-serve-"));
  storage = createDiskStorage({ dir: join(base, "store") });
  handler = createStorageHandler(storage);
  await storage.put("media/a.png", new Uint8Array([137, 80, 78, 71]));
  await writeFile(join(base, "secret.png"), "outside the store");
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const get = (path: string, init?: RequestInit) =>
  handler(new Request(`http://app.test${path}`, init));

describe("createStorageHandler", () => {
  test("serves an object with its allowlisted type and safe headers", async () => {
    const res = await get("/storage/media/a.png");
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toBe("image/png");
    expect(res?.headers.get("content-length")).toBe("4");
    expect(res?.headers.get("cache-control")).toBe("no-cache");
    expect(res?.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res?.headers.get("content-disposition")).toBeNull();
    expect(new Uint8Array(await res!.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71]),
    );
  });

  test("a key's publicUrl is the path it serves at", async () => {
    await storage.put("media/with space/é.png", new Uint8Array([1]));
    const res = await get(storage.publicUrl("media/with space/é.png"));
    expect(res?.status).toBe(200);
  });

  test("answers null outside its prefix so the router falls through", async () => {
    expect(await get("/")).toBeNull();
    expect(await get("/storagex/media/a.png")).toBeNull();
    expect(await get("/assets/app.js")).toBeNull();
  });

  test("refuses traversal that survives URL normalisation", async () => {
    // These stay under the prefix after `new URL`, so the handler itself has
    // to refuse them.
    for (const path of [
      "/storage/..%2fsecret.png",
      "/storage/..%2Fsecret.png",
      "/storage/%2e%2e%2fsecret.png",
      "/storage/..%5csecret.png",
      "/storage/media%2f..%2f..%2fsecret.png",
      "/storage//secret.png",
      "/storage/media//../secret.png",
      "/storage/%00.png",
      "/storage/%E0%A4%A.png",
    ]) {
      const res = await get(path);
      expect(res?.status).toBe(404);
      expect(await res!.text()).not.toInclude("outside the store");
    }
  });

  test("dot segments normalised out of the prefix are not served", async () => {
    for (const path of [
      "/storage/../secret.png",
      "/storage/media/../../secret.png",
      "/storage/%2e%2e/secret.png",
      "/storage/.%2E/secret.png",
    ]) {
      expect(await get(path)).toBeNull();
    }
  });

  test("refuses anything not on the allowlist, even when it exists", async () => {
    for (const key of ["x.svg", "x.html", "x.js", "x.css", "x.xml", "noext"]) {
      await storage.put(key, "<script>alert(1)</script>", "text/html");
      const res = await get(`/storage/${key}`);
      expect(res?.status).toBe(404);
    }
  });

  test("the type comes from the extension, never from what was stored", async () => {
    const memory = createMemoryStorage();
    await memory.put("evil.png", "<script>alert(1)</script>", "text/html");
    const res = await createStorageHandler(memory)(
      new Request("http://app.test/storage/evil.png"),
    );
    expect(res?.headers.get("content-type")).toBe("image/png");
  });

  test("download types are sent as attachments", async () => {
    await storage.put("exports/report q3.csv", "a,b\n");
    const res = await get("/storage/exports/report%20q3.csv");
    expect(res?.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res?.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''report%20q3.csv",
    );
  });

  test("a missing object is a 404 that is not cached", async () => {
    const res = await get("/storage/media/missing.png");
    expect(res?.status).toBe(404);
    expect(res?.headers.get("cache-control")).toBe("no-store");
  });

  test("HEAD sends the headers and no body", async () => {
    const res = await get("/storage/media/a.png", { method: "HEAD" });
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toBe("image/png");
    expect(await res!.text()).toBe("");
  });

  test("other methods are 405", async () => {
    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await get("/storage/media/a.png", { method });
      expect(res?.status).toBe(405);
      expect(res?.headers.get("allow")).toBe("GET, HEAD");
    }
  });

  test("takes a prefix and a cache policy", async () => {
    const custom = createStorageHandler(storage, {
      prefix: "media",
      cacheControl: "public, max-age=31536000, immutable",
    });
    const res = await custom(new Request("http://app.test/media/media/a.png"));
    expect(res?.status).toBe(200);
    expect(res?.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(
      await custom(new Request("http://app.test/storage/media/a.png")),
    ).toBeNull();
  });

  test("works through Bun.serve end to end", async () => {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        return (await handler(req)) ?? new Response("app", { status: 404 });
      },
    });
    try {
      const origin = `http://127.0.0.1:${server.port}`;
      const ok = await fetch(`${origin}/storage/media/a.png`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("content-type")).toBe("image/png");
      const head = await fetch(`${origin}/storage/media/a.png`, {
        method: "HEAD",
      });
      expect(head.headers.get("content-length")).toBe("4");
      const raw = await fetch(`${origin}/storage/%2e%2e/secret.png`);
      expect(await raw.text()).not.toInclude("outside the store");
    } finally {
      server.stop(true);
    }
  });
});
