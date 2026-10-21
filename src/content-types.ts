/**
 * The fixed allowlist of types the serving handler will send, by extension.
 *
 * Deliberately absent: SVG, HTML, XML, JavaScript and CSS. Any of them served
 * from the app's own origin is a stored-XSS vector, so a key with one of those
 * extensions (or none) is refused rather than sent as something else.
 *
 * `download: true` sends `Content-Disposition: attachment`, for types a browser
 * would otherwise try to open or hand to another program.
 */
export interface ServableType {
  type: string;
  download: boolean;
}

export const SERVABLE_TYPES: Readonly<Record<string, ServableType>> =
  Object.freeze({
    jpg: { type: "image/jpeg", download: false },
    jpeg: { type: "image/jpeg", download: false },
    png: { type: "image/png", download: false },
    webp: { type: "image/webp", download: false },
    avif: { type: "image/avif", download: false },
    gif: { type: "image/gif", download: false },
    pdf: { type: "application/pdf", download: false },
    txt: { type: "text/plain; charset=utf-8", download: false },
    json: { type: "application/json", download: false },
    csv: { type: "text/csv; charset=utf-8", download: true },
    zip: { type: "application/zip", download: true },
    xlsx: {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      download: true,
    },
    docx: {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      download: true,
    },
    mp4: { type: "video/mp4", download: false },
    webm: { type: "video/webm", download: false },
    mp3: { type: "audio/mpeg", download: false },
  });

const extensionOf = (key: string): string => {
  const name = key.slice(key.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
};

/** The allowlist entry for a key's extension, or `null`. */
export const servableType = (key: string): ServableType | null =>
  Object.hasOwn(SERVABLE_TYPES, extensionOf(key))
    ? (SERVABLE_TYPES[extensionOf(key)] as ServableType)
    : null;

/** The content type a key's extension implies, or `null`. */
export const contentTypeFor = (key: string): string | null =>
  servableType(key)?.type ?? null;

export const DEFAULT_CONTENT_TYPE = "application/octet-stream";
