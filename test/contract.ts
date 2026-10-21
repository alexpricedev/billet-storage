import { describe, expect, test } from "bun:test";
import { InvalidKeyError, type Storage } from "../src";

/**
 * What every driver promises, run against each of them, so an app that works
 * against disk in development behaves the same against S3.
 */
export const storageContract = (
  name: string,
  make: () => Storage | Promise<Storage>,
): void => {
  describe(`${name}: the Storage contract`, () => {
    test("put then get returns the bytes, size and type", async () => {
      const storage = await make();
      await storage.put(
        "reports/2026/summary.pdf",
        "%PDF-1.7",
        "application/pdf",
      );
      const file = await storage.get("reports/2026/summary.pdf");
      expect(file).not.toBeNull();
      expect(file?.key).toBe("reports/2026/summary.pdf");
      expect(file?.size).toBe(8);
      expect(file?.contentType).toBe("application/pdf");
      expect(await file?.text()).toBe("%PDF-1.7");
    });

    test("accepts Uint8Array, ArrayBuffer, Blob and string bodies", async () => {
      const storage = await make();
      const bytes = new Uint8Array([1, 2, 3]);
      await storage.put("a.bin", bytes);
      await storage.put("b.bin", bytes.buffer.slice(0));
      await storage.put("c.bin", new Blob([bytes]));
      await storage.put("d.txt", "hi");
      for (const key of ["a.bin", "b.bin", "c.bin"]) {
        expect(await (await storage.get(key))?.bytes()).toEqual(bytes);
      }
      expect(await (await storage.get("d.txt"))?.text()).toBe("hi");
    });

    test("stream() yields the whole object", async () => {
      const storage = await make();
      await storage.put("photos/p.png", new Uint8Array([137, 80, 78, 71]));
      const file = await storage.get("photos/p.png");
      const read = new Uint8Array(
        await new Response(file?.stream()).arrayBuffer(),
      );
      expect(read).toEqual(new Uint8Array([137, 80, 78, 71]));
    });

    test("put overwrites", async () => {
      const storage = await make();
      await storage.put("x.txt", "one");
      await storage.put("x.txt", "two");
      expect(await (await storage.get("x.txt"))?.text()).toBe("two");
    });

    test("the type defaults from the extension, else octet-stream", async () => {
      const storage = await make();
      await storage.put("img/photo.webp", new Uint8Array([1]));
      await storage.put("blob/data", new Uint8Array([1]));
      expect((await storage.get("img/photo.webp"))?.contentType).toBe(
        "image/webp",
      );
      expect((await storage.get("blob/data"))?.contentType).toBe(
        "application/octet-stream",
      );
    });

    test("get of a missing key is null", async () => {
      const storage = await make();
      expect(await storage.get("nothing/here.png")).toBeNull();
    });

    test("delete removes, and a missing key is not an error", async () => {
      const storage = await make();
      await storage.put("gone.txt", "x");
      await storage.delete("gone.txt");
      expect(await storage.get("gone.txt")).toBeNull();
      await storage.delete("gone.txt");
    });

    test("every operation refuses a key that could escape", async () => {
      const storage = await make();
      for (const key of [
        "../outside.txt",
        "a/../../b.txt",
        "/abs.txt",
        "a\\b",
      ]) {
        await expect(storage.put(key, "x")).rejects.toBeInstanceOf(
          InvalidKeyError,
        );
        await expect(storage.get(key)).rejects.toBeInstanceOf(InvalidKeyError);
        await expect(storage.delete(key)).rejects.toBeInstanceOf(
          InvalidKeyError,
        );
      }
    });
  });
};
