# Changelog

All notable changes to this project are documented here. This project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0]

- Initial release: one `Storage` interface (`put`, `get`, `delete`, `publicUrl`) for any file, with three drivers: `createS3Storage` (Bun's built-in S3 client, credentials always passed explicitly), `createDiskStorage` (development and tests; refused under `NODE_ENV=production`) and `createMemoryStorage` (tests).
- `storageFromEnv`: S3 when `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are set; otherwise disk outside production; otherwise a `StorageConfigError` naming the missing variables. Never disk in production. Partial S3 config throws in any environment.
- `assertKey`: one key rule for every driver. Keys that could leave the disk directory (`..`, a leading slash, a backslash, empty segments, control characters) are refused before any I/O, and the disk driver also checks the real path so a symlink cannot escape.
- `createStorageHandler`: a `(req) => Response | null` route handler for serving a store, with traversal refused, the `Content-Type` taken from a fixed allowlist (`SERVABLE_TYPES`, no SVG, HTML or script), `nosniff`, `no-cache` by default, and attachments for download types.
