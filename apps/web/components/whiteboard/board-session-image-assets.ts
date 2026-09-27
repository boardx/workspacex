import type { CanonicalContentObject } from "@repo/whiteboard-core";

export type BoardImageMime = Extract<CanonicalContentObject, { type: "image" }>["mimeType"];

export interface BoardSessionImageAsset {
  assetId: string;
  objectUrl: string;
  blob: Blob;
  mimeType: BoardImageMime;
  byteSize: number;
  contentDigest: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
}

const assets = new Map<string, BoardSessionImageAsset>();
const MAX_SESSION_IMAGE_BYTES = 200 * 1024 * 1024;
let retainedBytes = 0;

/** Bytes live only in this browser session. The canonical document stores the opaque handle and verified metadata. */
export function registerBoardSessionImageAsset(input: Omit<BoardSessionImageAsset, "assetId" | "objectUrl">): BoardSessionImageAsset {
  if (input.byteSize !== input.blob.size) throw new Error("SESSION_ASSET_SIZE_MISMATCH");
  if (retainedBytes + input.byteSize > MAX_SESSION_IMAGE_BYTES) throw new Error("SESSION_ASSET_CAPACITY_EXCEEDED");
  const assetId = `local-session-${crypto.randomUUID()}`;
  const asset = { ...input, assetId, objectUrl: URL.createObjectURL(input.blob) };
  assets.set(assetId, asset);
  retainedBytes += input.byteSize;
  return asset;
}

export function getBoardSessionImageAsset(assetId: string | null | undefined): BoardSessionImageAsset | undefined {
  return assetId ? assets.get(assetId) : undefined;
}

export function revokeBoardSessionImageAsset(assetId: string): void {
  const asset = assets.get(assetId);
  if (!asset) return;
  URL.revokeObjectURL(asset.objectUrl);
  assets.delete(assetId);
  retainedBytes = Math.max(0, retainedBytes - asset.byteSize);
}
