# @alexpricedev/billet-storage

File storage for Billet apps. An S3-compatible bucket in production, a directory on local disk in development, and one small interface over both, so a dev environment needs no bucket and the code that stores a file doesn't change between them. Bun only: it uses Bun's built-in S3 client, so there is no SDK.

- **Any file:** images, PDFs, exports, whatever the app makes.
- **Three drivers:** `s3`, `disk` (dev and test only) and `memory` (tests).
- **`storageFromEnv()`** picks the driver. It never falls back to disk in production.
- **`createStorageHandler()`** serves the disk store from the app's own router, so you don't write your own `/storage/*` route and get traversal wrong.

## Copy this to your coding agent

```text
Install and wire up @alexpricedev/billet-storage in this Billet app.

1. Read the package README first:
   https://github.com/alexpricedev/billet-storage#readme.
   Follow "Wire up a Billet app", steps 1 to 4. Adapt the snippets to
   this repo's file names; don't paste blindly.

2. Read this repo's CLAUDE.md or AGENTS.md and follow its conventions
   (logger, env validation, where tests go). They override anything
   generic in the package README.

3. Store object keys in the database, not URLs. Build URLs with
   storage.publicUrl(key) when rendering.

4. Mount the serving handler only when the store is the disk driver.

5. Add tests with createMemoryStorage(): what was written under which
   key, and the route that serves it. Run the repo's check and test
   scripts.

6. Add the env vars to .env.example and the deploy docs. Never commit
   real bucket credentials.

7. Open a PR. Check `git log` for the repo's commit convention first.
```

## For AI agents

- **Package**: `@alexpricedev/billet-storage`
- **Install**: `bun add @alexpricedev/billet-storage`
- **Runtime**: Bun ≥ 1.2. No dependencies.
- **Exports** (one entry point, `.`): `storageFromEnv`, `createS3Storage`, `createDiskStorage`, `createMemoryStorage`, `createStorageHandler`, `assertKey`, `contentTypeFor`, `SERVABLE_TYPES`, plus the types `Storage`, `PublicStorage` and `StoredFile`.
- **Side effects**: none at import. Nothing touches the disk or a bucket until you call `put`, `get` or `delete`.
- **Env vars**: `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (required together), `S3_REGION`, `S3_ENDPOINT`, `S3_SESSION_TOKEN`, `STORAGE_PUBLIC_BASE_URL`, `STORAGE_DIR`. It never reads `AWS_*`.

## The interface

```ts
interface Storage {
  put(key: string, body: Uint8Array | ArrayBuffer | Blob | string, contentType?: string): Promise<void>;
  get(key: string): Promise<StoredFile | null>;
  delete(key: string): Promise<void>; // a missing key is not an error
  publicUrl(key: string): string | null; // null: a private bucket
}

interface StoredFile {
  key: string;
  size: number;
  contentType: string;
  stream(): ReadableStream<Uint8Array>;
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
}
```

- `put` overwrites. `contentType` defaults to the type the key's extension implies, else `application/octet-stream`.
- `get` returns `null` for a missing key. The bytes aren't read until you call `stream()`, `bytes()` or `text()`, so `new Response(file.stream())` streams a large file without buffering it.
- `publicUrl` encodes each segment of the key. It is `null` only for an S3 store with no public base URL (a private bucket). `PublicStorage` is the same interface with `publicUrl` typed as `string`: disk, memory, and S3 created with a `publicBaseUrl` return it.

**Keys** are `/`-separated segments, such as `media/0f8e…/640.webp` or `reports/2026-09/summary.pdf`. Every driver refuses, with an `InvalidKeyError` and before any I/O, a key that is empty or longer than 1024 bytes, starts or ends with `/`, has an empty, `.` or `..` segment, or contains a backslash or a control character. Never build a key from raw user input without your own validation first; generated ids are the safe default.

## Drivers and their env vars

### s3: production

Any S3-compatible bucket (AWS, Cloudflare R2, MinIO, a Railway bucket) through `Bun.S3Client`.

| Variable | Required | |
|---|---|---|
| `S3_BUCKET` | yes | Bucket name |
| `S3_ACCESS_KEY_ID` | yes | |
| `S3_SECRET_ACCESS_KEY` | yes | |
| `S3_REGION` | no | Leave out on AWS's default region. R2 uses `auto`. |
| `S3_ENDPOINT` | no | Set for anything that isn't AWS |
| `S3_SESSION_TOKEN` | no | Temporary credentials |
| `STORAGE_PUBLIC_BASE_URL` | no | Where objects are publicly readable (the bucket's public URL, or a CDN in front of it). It's usually not the API endpoint. Leave it out for a private bucket. |

These are the names Railway's bucket plugin injects, so a Railway deploy needs no renaming. Every credential is passed to the client explicitly. Left to itself, Bun's client also falls back to `AWS_*` variables, and an unrelated AWS credential in the environment must never be the one the app writes with.

```ts
import { createS3Storage } from "@alexpricedev/billet-storage";

const storage = createS3Storage({
  bucket: "my-bucket",
  accessKeyId: process.env.S3_ACCESS_KEY_ID!,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  endpoint: "https://s3.example.com",
  publicBaseUrl: "https://files.example.com",
});
```

**Public objects and caching.** Bun's `write` can't set a per-object `Cache-Control`, so a long-lived cache header is a bucket or CDN rule. If your keys are written once (a UUID per upload), set `Cache-Control: public, max-age=31536000, immutable` on that prefix. Add the public host to your CSP `img-src` (or `media-src`, `connect-src`, whichever loads it).

**Private buckets.** Some providers refuse anonymous reads whatever the object ACL says (Railway's buckets do). Leave out `STORAGE_PUBLIC_BASE_URL`, store the key, and stream the file back through a route of your own that checks the user first:

```ts
const file = await storage.get(key);
if (!file) return new Response("Not found", { status: 404 });
return new Response(file.stream(), {
  headers: { "Content-Type": file.contentType, "Content-Length": String(file.size) },
});
```

### disk: development and tests

A directory on local disk. It is refused under `NODE_ENV=production`, because a container's disk is gone on the next deploy and each instance would have its own.

| Variable | Default | |
|---|---|---|
| `STORAGE_DIR` | `.storage` | Relative to the working directory. Add it to `.gitignore`. |
| `STORAGE_PUBLIC_BASE_URL` | `/storage` | Where the app serves the directory. Keep the default and mount `createStorageHandler` with its default prefix. Use an absolute URL when a different app serves the files. |

Keys are checked with `assertKey`, then the resolved path must stay inside `STORAGE_DIR`, and so must its real path once it exists, so a symlink inside the directory can't point outside it either. Disk keeps no metadata, so `get` reports the type the extension implies.

### memory: tests

```ts
import { createMemoryStorage } from "@alexpricedev/billet-storage";

const storage = createMemoryStorage(); // publicUrl → https://storage.test/<key>
await uploadAvatar(storage, user, bytes);
expect([...storage.objects.keys()]).toEqual([`avatars/${user.id}.webp`]);
```

`objects` is the `Map` behind it, so a test can assert exactly what was written, under which key and with which type.

## How `storageFromEnv` chooses

```ts
import { storageFromEnv } from "@alexpricedev/billet-storage";

export const storage = storageFromEnv(); // reads process.env
```

1. **S3** when `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are all set. If some of them are set but not all, it throws a `StorageConfigError` naming the missing ones, in every environment, because a half-configured bucket is a mistake, not "no bucket".
2. Otherwise, **disk**, unless `NODE_ENV=production`.
3. Otherwise (production with no bucket), it **throws** a `StorageConfigError` naming the missing variables. It never falls back to disk in production.

`STORAGE_DIR` is ignored, with a warning, whenever S3 is configured or `NODE_ENV=production`. Warnings go to `console.warn` by default. Pass `{ warn }` to route them to your logger: `storageFromEnv(process.env, { warn: (m) => log.warn("storage", m) })`. Blank values count as unset. An invalid `STORAGE_PUBLIC_BASE_URL` (anything but an http(s) URL or a path starting with `/`) throws. Errors never include a credential.

Call it once at boot, so a production deploy without a bucket fails at startup rather than on the first upload. If storage is optional in your app, use `s3ConfigFromEnv(env)`, which returns the config or `null`, and build what you need from that.

## The serving handler

`createStorageHandler(storage, options?)` returns `(req: Request) => Promise<Response | null>`:

- It returns **`null`** for any path outside its prefix, so the router can carry on.
- Under the prefix, it answers with the file or a refusal:
  - `GET` and `HEAD` are served. Any other method gets a `405`.
  - **Traversal is refused.** Each segment is decoded on its own (so `%2F` can't create a segment), then checked with `assertKey`. `..`, `%2e%2e%2f`, backslashes, NUL bytes and broken encodings all get a 404.
  - **The content type comes from a fixed allowlist**, by extension: jpg, jpeg, png, webp, avif, gif, pdf, txt, json, csv, zip, xlsx, docx, mp4, webm, mp3. It never uses the type the object was stored with. Anything else, including SVG, HTML, XML, JS, CSS or no extension, gets the same 404 as a missing file, so the response says nothing about what exists. csv, zip, xlsx and docx are sent with `Content-Disposition: attachment`.
  - **Safe headers:** `X-Content-Type-Options: nosniff`, and `Cache-Control: no-cache` by default (the browser revalidates, which is right when a key can be overwritten). A 404 is `no-store`.

| Option | Default | |
|---|---|---|
| `prefix` | `/storage/` | Must match the store's `publicBaseUrl` path |
| `cacheControl` | `no-cache` | Use `public, max-age=31536000, immutable` only if every key is written exactly once |

It does **no access control**: everything under the prefix is readable by anyone who can reach the app. It is meant for the disk driver in development. Don't mount it over a private bucket in production; write an authorised route instead (see Private buckets above).

## Wire up a Billet app

Paths below are Billet's. Adapt them where your app differs.

### 1. Install

```bash
bun add @alexpricedev/billet-storage
echo ".storage/" >> .gitignore
```

### 2. Create the service

```ts
// src/server/services/storage.ts
import { createMemoryStorage, type Storage, storageFromEnv } from "@alexpricedev/billet-storage";
import { log } from "./logger";

let storage: Storage | undefined;

/** Built on first use; call it from main.ts so a bad config fails at boot. */
export const getStorage = (): Storage =>
  (storage ??= storageFromEnv(process.env, { warn: (m) => log.warn("storage", m) }));

/** For tests: `setStorageForTest(createMemoryStorage())`. */
export const setStorageForTest = (next: Storage | undefined): void => {
  storage = next;
};
```

Call `getStorage()` in `src/server/main.ts` next to `validateEnv()`.

### 3. Serve the disk store in development

Add the handler to `handleFallback` in `src/server/utils/fallback.ts`, before the `public/` lookup, so the trailing-slash rule still runs first and the guarded pipeline still adds the security headers:

```ts
import { createStorageHandler } from "@alexpricedev/billet-storage";
import { getStorage } from "../services/storage";

// Only outside production: there the files come from the bucket's own URL.
const serveStorage =
  process.env.NODE_ENV === "production" ? null : createStorageHandler(getStorage());

export const handleFallback = async (req: Request): Promise<Response> => {
  // …trailing slashes, /health, /assets/…

  const stored = await serveStorage?.(req);
  if (stored) return stored;

  // …public/ files, then render404()
};
```

Files served from `/storage` are same-origin, so the default CSP `img-src 'self'` already covers them in development.

### 4. Use it

```ts
const key = `avatars/${user.id}.webp`;
await getStorage().put(key, bytes, "image/webp");
await db`UPDATE users SET avatar_key = ${key} WHERE id = ${user.id}`;

// rendering
const src = getStorage().publicUrl(user.avatar_key);
```

Store the **key** and build the URL at render time. Then moving from disk to a bucket, or putting a CDN in front of it, changes no rows.

## Moving a dev setup to a real bucket

1. Create the bucket and an access key limited to it. Decide public or private. If it's public, note its public URL. If it's private, plan an authorised route (see Private buckets).
2. Set `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, plus `S3_ENDPOINT` and `S3_REGION` as your provider needs, and `STORAGE_PUBLIC_BASE_URL` for a public bucket. Put them in your host's secret settings, never in the repo. Remove `STORAGE_DIR`.
3. If you need the files you made locally, copy them across once:

   ```ts
   // scripts/copy-storage.ts — run with the S3 vars set
   import { createDiskStorage, storageFromEnv } from "@alexpricedev/billet-storage";

   const disk = createDiskStorage({ dir: ".storage" });
   const bucket = storageFromEnv();
   for await (const key of new Bun.Glob("**/*").scan({ cwd: ".storage" })) {
     const file = await disk.get(key);
     if (file) await bucket.put(key, await file.bytes());
   }
   ```

4. If you stored URLs rather than keys, rewrite them: `/storage/<key>` becomes `<STORAGE_PUBLIC_BASE_URL>/<key>`.
5. Add the public host to the CSP, and set the long-lived `Cache-Control` rule on the bucket if your keys are written once.
6. Deploy. If a variable is missing, boot fails with the names of the missing variables. That's the intended result: the app doesn't quietly start up without storage.

## Adopting it in an app that already talks to S3

The package grew out of storage code copied between Billet apps. Two patterns that already exist would move like this:

- **Generated documents in a bucket** (for example, monthly PDF reports, a JSON manifest and a large zip, read back through an authorised download route). `put`, `get` and `delete` replace the single-object writes and reads, and the download route streams `get(key).stream()`. Tests can use `createMemoryStorage()` instead of a hand-written fake. Two things stay app code for now, because the interface doesn't cover them yet: the multipart writer for the large zip, and prefix listing. Keep that code on `Bun.S3Client` alongside the package. The keys should already pass `assertKey`.
- **Images copied into a private bucket and served from the app's own route** (with byte sniffing, SVG refused, and only the key stored). `imageStoreConfig` and the per-call client become `storageFromEnv()`. The upload becomes `put(key, bytes, sniffedType)`. The serving route keeps its own access checks and streams `get(key)`. Content sniffing and trimming stay in the app. The private-bucket behaviour is the default (no `STORAGE_PUBLIC_BASE_URL`, so `publicUrl` returns `null`). Development gains the disk driver, so it no longer needs a bucket.

## Development

```bash
bun install
bun run check   # biome + tsc
bun test        # no network: S3 runs against an in-memory fake and a loopback server
```

## License

MIT
