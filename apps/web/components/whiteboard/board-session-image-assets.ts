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

/** Bytes live only in this browser session. The canonical document stores the opaque handle and verified metadata. */
export function registerBoardSessionImageAsset(input: Omit<BoardSessionImageAsset, "assetId" | "objectUrl">): BoardSessionImageAsset {
  const assetId = `local-session-${crypto.randomUUID()}`;
  const asset = { ...input, assetId, objectUrl: URL.createObjectURL(input.blob) };
  assets.set(assetId, asset);
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
}

