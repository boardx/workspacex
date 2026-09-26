import { readContentObject, type CanonicalContentObject, type DrawingTool, type ShapeVariant, type WhiteboardObject } from "@repo/whiteboard-core";

export type BoardShapeVariant = ShapeVariant;
export type BoardDrawingTool = Exclude<DrawingTool, "eraser">;
export type BoardStructuredKind = Extract<CanonicalContentObject["type"], "tile" | "web-tile" | "table" | "icon" | "template">;
export type BoardContentData = CanonicalContentObject;

/** Renderer-facing name keeps the web boundary explicit while validation stays canonical. */
export function readBoardContent(object: WhiteboardObject): BoardContentData | undefined {
  return readContentObject(object) ?? undefined;
}

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"]);
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

async function readBoundedBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > limit) throw new Error("IMAGE_TOO_LARGE");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error("IMAGE_TOO_LARGE"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function inspectRemoteImageUrl(raw: string, fetcher: typeof fetch = fetch): Promise<{ url: string; mimeType: Extract<CanonicalContentObject, { type: "image" }>["mimeType"]; byteSize: number; contentDigest: string; magicMimeType: Extract<CanonicalContentObject, { type: "image" }>["mimeType"] }> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("IMAGE_URL_INVALID"); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("IMAGE_URL_INVALID");
  const safeInit: RequestInit = { cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" };
  const response = await fetcher(url.toString(), { ...safeInit, headers: { Range: "bytes=0-511" } });
  if (!response.ok || response.redirected) throw new Error("IMAGE_FETCH_FAILED");
  const contentRange = response.headers.get("content-range");
  const parsedRange = contentRange?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
  if (response.status === 206 && (!parsedRange || Number(parsedRange[1]) !== 0 || Number(parsedRange[2]) > 511 || Number(parsedRange[2]) >= Number(parsedRange[3]))) throw new Error("IMAGE_RANGE_INVALID");
  const rangeTotal = parsedRange?.[3];
  const contentLength = Number(rangeTotal ?? response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) throw new Error("IMAGE_TOO_LARGE");
  const mimeType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!IMAGE_MIME.has(mimeType)) throw new Error("IMAGE_MIME_INVALID");
  const prefixLimit = response.status === 206 ? 512 : MAX_IMAGE_BYTES;
  const prefix = await readBoundedBytes(response, prefixLimit);
  if (parsedRange && prefix.length !== Number(parsedRange[2]) - Number(parsedRange[1]) + 1) throw new Error("IMAGE_RANGE_INVALID");
  let bytes = prefix;
  if (response.status === 206) {
    const full = await fetcher(url.toString(), safeInit);
    if (!full.ok || full.redirected || full.status !== 200 || (full.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase() !== mimeType) throw new Error("IMAGE_FETCH_FAILED");
    const fullLength = Number(full.headers.get("content-length") ?? 0);
    if (fullLength > MAX_IMAGE_BYTES) throw new Error("IMAGE_TOO_LARGE");
    bytes = await readBoundedBytes(full, MAX_IMAGE_BYTES);
    if ((contentLength && bytes.length !== contentLength) || bytes.length > MAX_IMAGE_BYTES) throw new Error("IMAGE_SIZE_MISMATCH");
  }
  const text = new TextDecoder().decode(bytes).trimStart();
  const valid = mimeType === "image/png" ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    : mimeType === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mimeType === "image/gif" ? text.startsWith("GIF87a") || text.startsWith("GIF89a")
    : mimeType === "image/webp" ? text.startsWith("RIFF") && text.slice(8, 12) === "WEBP"
    : /^<svg[\s>]/i.test(text) || /^<\?xml[\s\S]*<svg[\s>]/i.test(text);
  if (!valid) throw new Error("IMAGE_MAGIC_INVALID");
  const digestInput = new Uint8Array(bytes).buffer;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", digestInput));
  const canonicalMime = mimeType as Extract<CanonicalContentObject, { type: "image" }>["mimeType"];
  return { url: url.toString(), mimeType: canonicalMime, byteSize: bytes.length, contentDigest: `sha256:${[...digest].map(value => value.toString(16).padStart(2, "0")).join("")}`, magicMimeType: canonicalMime };
}
