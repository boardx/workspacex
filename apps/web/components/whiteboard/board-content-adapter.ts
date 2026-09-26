import { readContentObject, type CanonicalContentObject, type DrawingTool, type ShapeVariant, type WhiteboardObject } from "@repo/whiteboard-core";
import type { BoardImageMime } from "./board-session-image-assets";

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

async function readBoundedBytes(source: Pick<Response, "body" | "arrayBuffer"> | Blob, limit: number): Promise<Uint8Array> {
  if (!("body" in source) || !source.body) {
    if ("size" in source && source.size > limit) throw new Error("IMAGE_TOO_LARGE");
    const buffer = typeof source.arrayBuffer === "function" ? await source.arrayBuffer() : await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("IMAGE_READ_FAILED"));
      reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error("IMAGE_READ_FAILED"));
      reader.readAsArrayBuffer(source as Blob);
    });
    const bytes = new Uint8Array(buffer);
    if (bytes.length > limit) throw new Error("IMAGE_TOO_LARGE");
    return bytes;
  }
  const reader = source.body.getReader();
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

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function gifDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 10) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  for (let offset = 2; offset + 8 < bytes.length;) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1]!;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!, width: (bytes[offset + 7]! << 8) | bytes[offset + 8]! };
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2) return null;
    offset += length + 2;
  }
  return null;
}

function sanitizeSvg(bytes: Uint8Array): { bytes: Uint8Array; width: number; height: number } {
  const source = new TextDecoder().decode(bytes);
  if (/<!doctype|<!entity/i.test(source)) throw new Error("IMAGE_MAGIC_INVALID");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (document.querySelector("parsererror") || document.documentElement.localName !== "svg") throw new Error("IMAGE_MAGIC_INVALID");
  document.querySelectorAll("script,foreignObject,iframe,object,embed,audio,video,style,image,use,link,feImage").forEach((node) => node.remove());
  for (const element of Array.from(document.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase(), value = attribute.value.trim();
      const externalUrl = /url\s*\(/i.test(value) && !/^url\(\s*#[^)]+\s*\)$/i.test(value);
      if (name.startsWith("on") || ((name === "href" || name.endsWith(":href")) && !value.startsWith("#")) || externalUrl || (name === "style" && /expression\s*\(/i.test(value))) element.removeAttribute(attribute.name);
    }
  }
  const root = document.documentElement;
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const width = Number.parseFloat(root.getAttribute("width") ?? "") || (viewBox?.length === 4 ? viewBox[2]! : 0);
  const height = Number.parseFloat(root.getAttribute("height") ?? "") || (viewBox?.length === 4 ? viewBox[3]! : 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error("IMAGE_DIMENSIONS_INVALID");
  return { bytes: new TextEncoder().encode(new XMLSerializer().serializeToString(document)), width: Math.round(width), height: Math.round(height) };
}

async function bitmapDimensions(bytes: Uint8Array, mimeType: BoardImageMime): Promise<{ width: number; height: number }> {
  const direct = mimeType === "image/png" ? pngDimensions(bytes) : mimeType === "image/gif" ? gifDimensions(bytes) : mimeType === "image/jpeg" ? jpegDimensions(bytes) : null;
  if (direct?.width && direct.height) return direct;
  if (typeof createImageBitmap !== "function") throw new Error("IMAGE_DIMENSIONS_INVALID");
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: mimeType }));
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  if (dimensions.width < 1 || dimensions.height < 1) throw new Error("IMAGE_DIMENSIONS_INVALID");
  return dimensions;
}

export interface VerifiedBoardImage {
  bytes: Uint8Array;
  blob: Blob;
  mimeType: BoardImageMime;
  byteSize: number;
  contentDigest: string;
  magicMimeType: BoardImageMime;
  intrinsicWidth: number;
  intrinsicHeight: number;
}

export async function verifyBoardImageBytes(source: Blob, declaredMime: string): Promise<VerifiedBoardImage> {
  if (!IMAGE_MIME.has(declaredMime)) throw new Error("IMAGE_MIME_INVALID");
  let bytes = await readBoundedBytes(source, MAX_IMAGE_BYTES);
  const mimeType = declaredMime as BoardImageMime;
  const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4096))).trimStart();
  const valid = mimeType === "image/png" ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    : mimeType === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mimeType === "image/gif" ? text.startsWith("GIF87a") || text.startsWith("GIF89a")
    : mimeType === "image/webp" ? text.startsWith("RIFF") && text.slice(8, 12) === "WEBP"
    : /^<svg[\s>]/i.test(text) || /^<\?xml[\s\S]*<svg[\s>]/i.test(text);
  if (!valid) throw new Error("IMAGE_MAGIC_INVALID");
  let dimensions: { width: number; height: number };
  if (mimeType === "image/svg+xml") {
    const sanitized = sanitizeSvg(bytes);
    bytes = sanitized.bytes;
    dimensions = sanitized;
  } else dimensions = await bitmapDimensions(bytes, mimeType);
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("IMAGE_TOO_LARGE");
  const digestInput = new Uint8Array(bytes).buffer;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", digestInput));
  return { bytes, blob: new Blob([new Uint8Array(bytes)], { type: mimeType }), mimeType, byteSize: bytes.length, contentDigest: `sha256:${[...digest].map(value => value.toString(16).padStart(2, "0")).join("")}`, magicMimeType: mimeType, intrinsicWidth: dimensions.width, intrinsicHeight: dimensions.height };
}

export async function inspectRemoteImageUrl(raw: string, fetcher: typeof fetch = fetch): Promise<VerifiedBoardImage & { url: string }> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("IMAGE_URL_INVALID"); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("IMAGE_URL_INVALID");
  const safeInit: RequestInit = { cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" };
  const response = await fetcher(url.toString(), { ...safeInit, headers: { Range: `bytes=0-${MAX_IMAGE_BYTES - 1}` } });
  if (!response.ok || response.redirected) throw new Error("IMAGE_FETCH_FAILED");
  const contentRange = response.headers.get("content-range");
  const parsedRange = contentRange?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
  if (response.status === 206 && (!parsedRange || Number(parsedRange[1]) !== 0 || Number(parsedRange[2]) >= MAX_IMAGE_BYTES || Number(parsedRange[2]) + 1 !== Number(parsedRange[3]))) throw new Error("IMAGE_RANGE_INVALID");
  const rangeTotal = parsedRange?.[3];
  const contentLength = Number(rangeTotal ?? response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) throw new Error("IMAGE_TOO_LARGE");
  const mimeType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!IMAGE_MIME.has(mimeType)) throw new Error("IMAGE_MIME_INVALID");
  const bytes = await readBoundedBytes(response, MAX_IMAGE_BYTES);
  if ((contentLength && bytes.length !== contentLength) || (parsedRange && bytes.length !== Number(parsedRange[2]) + 1)) throw new Error("IMAGE_SIZE_MISMATCH");
  return { url: url.toString(), ...await verifyBoardImageBytes(new Blob([new Uint8Array(bytes)], { type: mimeType }), mimeType) };
}
