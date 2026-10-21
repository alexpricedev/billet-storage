import { expect, test } from "bun:test";
import { createMemoryStorage } from "../src";
import { storageContract } from "./contract";

storageContract("memory", () => createMemoryStorage());

test("objects shows what was written", async () => {
  const storage = createMemoryStorage();
  await storage.put("a/b.png", new Uint8Array([1]), "image/png");
  expect([...storage.objects.keys()]).toEqual(["a/b.png"]);
  expect(storage.objects.get("a/b.png")?.contentType).toBe("image/png");
});

test("a stored body is a copy, so later mutation does not change it", async () => {
  const storage = createMemoryStorage();
  const body = new Uint8Array([1, 2]);
  await storage.put("a.bin", body);
  body[0] = 9;
  expect(await (await storage.get("a.bin"))?.bytes()).toEqual(
    new Uint8Array([1, 2]),
  );
});

test("publicUrl joins the base and encodes each segment", () => {
  expect(createMemoryStorage().publicUrl("media/a b/c.png")).toBe(
    "https://storage.test/media/a%20b/c.png",
  );
  expect(
    createMemoryStorage({
      publicBaseUrl: "https://cdn.example/files/",
    }).publicUrl("x.png"),
  ).toBe("https://cdn.example/files/x.png");
});

test("refuses a publicBaseUrl that is not http(s) or a path", () => {
  for (const publicBaseUrl of [
    "javascript:alert(1)",
    "ftp://x",
    "//evil.example",
    "files",
  ]) {
    expect(() => createMemoryStorage({ publicBaseUrl })).toThrow();
  }
});
