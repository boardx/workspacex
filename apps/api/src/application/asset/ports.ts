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

/**
 * F134's stored shape for `AssetGovernance` (`uc-23-4` R3). Deliberately identical for all six
 * `AssetKind`s -- there is no per-kind variant of this record, which is the "six kinds share one
 * governance shape" reading of Q-1b (`asset-governance.KNOWN_CONTRACT_GAPS.AG1`) made concrete.
 */
export interface AssetGovernanceRecord {
  readonly visibility: "specified-teams" | "whole-org" | "private-draft";
  readonly teamIds: readonly string[];
  readonly editableBy: readonly string[];
  readonly ownerId: string;
  readonly reviewCycle: "6m" | "12m" | "24m";
}

export interface AssetGovernanceRepository {
  /** `null` = no governance has ever been set for this (kind, assetId) -- not a default value. */
  get(assetKind: AssetKind, assetId: string): Promise<AssetGovernanceRecord | null>;
  set(assetKind: AssetKind, assetId: string, governance: AssetGovernanceRecord): Promise<void>;
}

export const ASSET_GOVERNANCE_REPOSITORY = Symbol("AssetGovernanceRepository");
