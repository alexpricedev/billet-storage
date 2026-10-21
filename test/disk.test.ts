import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDiskStorage, InvalidKeyError } from "../src";
import { storageContract } from "./contract";

let base: string;
let dir: string;
let outside: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "billet-storage-"));
  dir = join(base, "store");
  outside = join(base, "outside");
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

storageContract("disk", () => createDiskStorage({ dir }));

describe("disk", () => {
  test("writes under the directory, creating it", async () => {
    const storage = createDiskStorage({ dir });
    await storage.put("media/1/a.txt", "hello");
    expect(await readFile(join(dir, "media/1/a.txt"), "utf8")).toBe("hello");
  });

  test("put refuses traversal and writes nothing outside", async () => {
    const storage = createDiskStorage({ dir });
    for (const key of [
      "../outside",
      "../outside/x.txt",
      "media/../../outside/x.txt",
    ]) {
      await expect(storage.put(key, "x")).rejects.toBeInstanceOf(
        InvalidKeyError,
      );
    }
    await expect(stat(outside)).rejects.toThrow();
  });

  test("a symlink inside the directory cannot reach outside it", async () => {
    const storage = createDiskStorage({ dir });
    await storage.put("keep.txt", "in");
    await Bun.write(join(outside, "secret.txt"), "secret");
    await symlink(outside, join(dir, "link"));
    await expect(storage.put("link/new.txt", "x")).rejects.toBeInstanceOf(
      InvalidKeyError,
    );
    await expect(storage.get("link/secret.txt")).rejects.toBeInstanceOf(
      InvalidKeyError,
    );
    await expect(storage.delete("link/secret.txt")).rejects.toBeInstanceOf(
      InvalidKeyError,
    );
    expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("secret");
    expect(await Bun.file(join(outside, "new.txt")).exists()).toBe(false);
  });

  test("get of a directory is null", async () => {
    const storage = createDiskStorage({ dir });
    await storage.put("media/1/a.txt", "x");
    expect(await storage.get("media/1")).toBeNull();
  });

  test("get before the directory exists is null", async () => {
    expect(await createDiskStorage({ dir }).get("a.txt")).toBeNull();
  });

  test("the type comes from the extension, since disk keeps no metadata", async () => {
    const storage = createDiskStorage({ dir });
    await storage.put("a.png", new Uint8Array([1]), "text/html");
    expect((await storage.get("a.png"))?.contentType).toBe("image/png");
  });

  test("publicUrl defaults to /storage on the app's own origin", () => {
    expect(createDiskStorage({ dir }).publicUrl("media/a.png")).toBe(
      "/storage/media/a.png",
    );
    expect(
      createDiskStorage({
        dir,
        publicBaseUrl: "http://localhost:3000/media",
      }).publicUrl("a.png"),
    ).toBe("http://localhost:3000/media/a.png");
  });

  test("is refused under NODE_ENV=production", () => {
    expect(() =>
      createDiskStorage({ dir, env: { NODE_ENV: "production" } }),
    ).toThrow(/development and tests only/);
  });

  test("files placed by hand are readable", async () => {
    const storage = createDiskStorage({ dir });
    await storage.put("seed.txt", "x");
    await writeFile(join(dir, "manual.txt"), "by hand");
    expect(await (await storage.get("manual.txt"))?.text()).toBe("by hand");
  });
});
