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

export async function inspectRemoteImageUrl(raw: string, fetcher: typeof fetch = fetch): Promise<{ url: string; mimeType: Extract<CanonicalContentObject, { type: "image" }>["mimeType"] }> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("IMAGE_URL_INVALID"); }
  if (url.protocol !== "https:") throw new Error("IMAGE_URL_INVALID");
  const response = await fetcher(url.toString(), { headers: { Range: "bytes=0-511" }, cache: "no-store" });
  if (!response.ok) throw new Error("IMAGE_FETCH_FAILED");
  const rangeTotal = response.headers.get("content-range")?.match(/\/(\d+)$/)?.[1];
  const contentLength = Number(rangeTotal ?? response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) throw new Error("IMAGE_TOO_LARGE");
  const mimeType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!IMAGE_MIME.has(mimeType)) throw new Error("IMAGE_MIME_INVALID");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(bytes).trimStart();
  const valid = mimeType === "image/png" ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    : mimeType === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mimeType === "image/gif" ? text.startsWith("GIF87a") || text.startsWith("GIF89a")
    : mimeType === "image/webp" ? text.startsWith("RIFF") && text.slice(8, 12) === "WEBP"
    : /^<svg[\s>]/i.test(text) || /^<\?xml[\s\S]*<svg[\s>]/i.test(text);
  if (!valid) throw new Error("IMAGE_MAGIC_INVALID");
  return { url: url.toString(), mimeType: mimeType as Extract<CanonicalContentObject, { type: "image" }>["mimeType"] };
}
