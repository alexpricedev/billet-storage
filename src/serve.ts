import { servableType } from "./content-types";
import { assertKey } from "./keys";
import type { Storage } from "./types";

export interface StorageHandlerOptions {
  /**
   * The path the store is served under, matching the store's
   * `publicBaseUrl`. Default `/storage/`.
   */
  prefix?: string;
  /**
   * Default `no-cache`: the browser keeps a copy but checks back, which is
   * right when a key can be overwritten. Pass
   * `public, max-age=31536000, immutable` only if every key is written once.
   */
  cacheControl?: string;
}

const refuse = (status: number, headers: Record<string, string> = {}) =>
  new Response(status === 405 ? "Method Not Allowed" : "Not Found", {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });

/**
 * The key a request path names, or `null`. Each segment is decoded on its own,
 * so `%2F` cannot make a new segment and `%2E%2E` is still `..`, which
 * `assertKey` then refuses.
 */
const keyFromPath = (rest: string): string | null => {
  try {
    const key = rest
      .split("/")
      .map((segment) => {
        const decoded = decodeURIComponent(segment);
        if (decoded.includes("/")) throw new Error("encoded slash");
        return decoded;
      })
      .join("/");
    return assertKey(key);
  } catch {
    return null;
  }
};

/**
 * A route handler that serves a store, for development against the disk
 * driver: `(req) => Response | null`. It answers `null` for any path outside
 * `prefix`, so it slots in front of an app's own fallback.
 *
 * Under the prefix it only ever answers with the object or a refusal: a path
 * that would leave the store, a key whose extension is not in
 * `SERVABLE_TYPES` (no SVG, HTML or script, ever) and a missing object are all
 * the same 404, so the response says nothing about what exists. The
 * `Content-Type` comes from the allowlist by extension, never from what the
 * object was stored with.
 *
 * It does no access control. Anything under the prefix is public to whoever
 * can reach the app.
 */
export const createStorageHandler = (
  storage: Storage,
  options: StorageHandlerOptions = {},
): ((req: Request) => Promise<Response | null>) => {
  const trimmed = (options.prefix ?? "/storage/").replace(/^\/+|\/+$/g, "");
  const prefix = trimmed ? `/${trimmed}/` : "/";
  const cacheControl = options.cacheControl ?? "no-cache";

  return async (req) => {
    const { pathname } = new URL(req.url);
    if (!pathname.startsWith(prefix)) return null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      return refuse(405, { Allow: "GET, HEAD" });
    }

    const key = keyFromPath(pathname.slice(prefix.length));
    if (key === null) return refuse(404);
    const servable = servableType(key);
    if (servable === null) return refuse(404);

    const file = await storage.get(key);
    if (file === null) return refuse(404);

    const headers: Record<string, string> = {
      "Content-Type": servable.type,
      "Content-Length": String(file.size),
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
    };
    if (servable.download) {
      const name = key.slice(key.lastIndexOf("/") + 1);
      headers["Content-Disposition"] =
        `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
    }
    return new Response(req.method === "HEAD" ? null : file.stream(), {
      headers,
    });
  };
};
