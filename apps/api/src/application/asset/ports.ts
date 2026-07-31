/**
 * Ports for F141's two read use cases (`GetAssetDirectory` / `ReadAssetFile`).
 *
 * ⚠ **Scope is 2/6 `AssetKind`s, on purpose** (`asset-governance.KNOWN_CONTRACT_GAPS.AG4`).
 * Whether model / mcp / canvas-template / blueprint are directory-shaped is `[待确认]`, so
 * this port's implementation only knows how to answer for `skill` and `agent`. Any other
 * kind resolves to `null` from `getDirectory` / `readFile` -- which the use case turns into
 * the SAME "not found" outcome as an unknown `assetId`, not a distinct error code. Inventing
 * a code here (e.g. `ASSET_KIND_NOT_DIRECTORY`) would be this port casting a ruling nobody
 * has made.
 */
import type { z } from "zod";
import type { AssetKind as AssetKindSchema } from "@repo/contracts/asset-governance";

export type AssetKind = z.infer<typeof AssetKindSchema>;

export interface AssetFileEntryRecord {
  readonly path: string;
  readonly sizeBytes: number;
}

export interface AssetDirectoryRecord {
  readonly rootFile: string;
  readonly entries: readonly AssetFileEntryRecord[];
}

export interface AssetFileContentRecord {
  readonly sizeBytes: number;
  readonly body: string;
}

export interface AssetFileRepository {
  /** `null` = this (kind, assetId) has no directory -- unknown asset, or a kind out of scope. */
  getDirectory(assetKind: AssetKind, assetId: string): Promise<AssetDirectoryRecord | null>;
  /** `null` = the asset has no directory, or the directory has no such path. One outcome for both. */
  readFile(assetKind: AssetKind, assetId: string, path: string): Promise<AssetFileContentRecord | null>;
}

export const ASSET_FILE_REPOSITORY = Symbol("AssetFileRepository");
