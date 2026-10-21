/**
 * A public base URL: an absolute http(s) URL, or (for a store the app serves
 * itself) a path on the app's own origin starting with `/`.
 *
 * `new URL` alone is not the check: it parses `ftp:` and `javascript:` happily,
 * and every stored object's URL is built from this value and rendered into
 * pages. A protocol-relative `//host` is refused too, since it names another
 * origin while looking like a path.
 */
export const isPublicBaseUrl = (value: string): boolean => {
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

export const assertPublicBaseUrl = (value: string, name: string): string => {
  if (!isPublicBaseUrl(value)) {
    throw new Error(
      `${name} must be an absolute http(s) URL or a path starting with "/"; got ${JSON.stringify(value)}`,
    );
  }
  return value;
};
