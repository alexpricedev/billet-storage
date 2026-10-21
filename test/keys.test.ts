import { describe, expect, test } from "bun:test";
import { assertKey, InvalidKeyError } from "../src";

describe("assertKey", () => {
  test("accepts ordinary keys", () => {
    for (const key of [
      "a.png",
      "media/0f8e/640.webp",
      "reports/2026-09/2026-09_summary.pdf",
      "with space/é.txt",
      "..hidden/a..b.txt",
    ]) {
      expect(assertKey(key)).toBe(key);
    }
  });

  test("refuses keys that could escape or mean two things", () => {
    for (const key of [
      "",
      "/leading",
      "trailing/",
      "a//b",
      ".",
      "..",
      "../a",
      "a/../b",
      "a/./b",
      "a\\..\\b",
      "nul\u0000.txt",
      "new\nline",
      "x".repeat(1025),
    ]) {
      expect(() => assertKey(key)).toThrow(InvalidKeyError);
    }
  });
});
