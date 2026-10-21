/**
 * The one rule every driver holds a key to.
 *
 * A key is `/`-separated segments, each non-empty and none of them `.` or
 * `..`, with no leading or trailing slash, no backslash and no control
 * characters. On disk that is what stops a key leaving the storage directory;
 * in a bucket it keeps a key and the URL built from it meaning the same thing,
 * so code that works against the disk driver in development works unchanged
 * against S3.
 */
export class InvalidKeyError extends Error {
  constructor(key: string, reason: string) {
    super(`Invalid storage key ${JSON.stringify(key)}: ${reason}`);
    this.name = "InvalidKeyError";
  }
}

// S3's own limit, in UTF-8 bytes.
const MAX_KEY_BYTES = 1024;

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
const CONTROL = /[\u0000-\u001f\u007f]/;

export const assertKey = (key: string): string => {
  if (typeof key !== "string" || key.length === 0) {
    throw new InvalidKeyError(String(key), "a key must be a non-empty string");
  }
  if (new TextEncoder().encode(key).length > MAX_KEY_BYTES) {
    throw new InvalidKeyError(key, `longer than ${MAX_KEY_BYTES} bytes`);
  }
  if (CONTROL.test(key)) {
    throw new InvalidKeyError(key, "contains a control character");
  }
  if (key.includes("\\")) {
    throw new InvalidKeyError(key, "contains a backslash");
  }
  for (const segment of key.split("/")) {
    if (segment === "") {
      throw new InvalidKeyError(
        key,
        "has an empty segment (a leading, trailing or doubled slash)",
      );
    }
    if (segment === "." || segment === "..") {
      throw new InvalidKeyError(key, `has a "${segment}" segment`);
    }
  }
  return key;
};

/** `base` + the key, each segment percent-encoded. */
export const keyUrl = (base: string, key: string): string =>
  `${base.replace(/\/+$/, "")}/${assertKey(key).split("/").map(encodeURIComponent).join("/")}`;
