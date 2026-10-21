import { describe, expect, test } from "bun:test";
import { contentTypeFor, SERVABLE_TYPES, servableType } from "../src";

describe("the content-type allowlist", () => {
  test("never includes a type that can run script on the app's origin", () => {
    for (const ext of [
      "svg",
      "svgz",
      "html",
      "htm",
      "xhtml",
      "xml",
      "js",
      "mjs",
      "css",
    ]) {
      expect(servableType(`a.${ext}`)).toBeNull();
    }
    const types = Object.values(SERVABLE_TYPES).map(({ type }) => type);
    for (const type of types) {
      expect(type).not.toMatch(/html|\+xml|\/xml|svg|javascript|css/);
    }
  });

  test("matches extensions case-insensitively on the last segment only", () => {
    expect(contentTypeFor("A/B.PNG")).toBe("image/png");
    expect(contentTypeFor("a.png/b")).toBeNull();
    expect(contentTypeFor("no-extension")).toBeNull();
    expect(contentTypeFor(".png")).toBeNull();
  });

  test("ignores Object prototype names", () => {
    expect(servableType("a.constructor")).toBeNull();
    expect(servableType("a.__proto__")).toBeNull();
  });

  test("marks the types a browser should download", () => {
    expect(servableType("a.zip")?.download).toBe(true);
    expect(servableType("a.csv")?.download).toBe(true);
    expect(servableType("a.pdf")?.download).toBe(false);
    expect(servableType("a.jpg")?.download).toBe(false);
  });

  test("is frozen", () => {
    expect(Object.isFrozen(SERVABLE_TYPES)).toBe(true);
  });
});
