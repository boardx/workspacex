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
  /**
   * `WriteAssetFile` (F142) -- persists `body` at `path`, returning the new size. `null` is the
   * SAME collapsed outcome as `readFile`: unknown (kind, assetId), or the directory has no such
   * path -- this port does not create new paths (that's `CreateAssetFile`, out of this
   * feature's scope).
   */
  writeFile(assetKind: AssetKind, assetId: string, path: string, body: string): Promise<AssetFileContentRecord | null>;
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

/**
 * `AssetGateStatusPort` -- F137's seam for `PublishAsset`'s `GATE_NOT_PASSED` check
 * (`asset-governance.ts` `AssetGovernanceError.GATE_NOT_PASSED`, domain I-5).
 *
 * 🔴 **The six landing gates themselves (`uc-23-2`) stay in phase-2 per Q-0/`DECISION-Q0.md`
 * (plan C) -- this bundle does not build `LandingCheck`, `GateVerdict`, or anything that runs
 * a real gate.** The issue's own notes are explicit that `GATE_NOT_PASSED` in phase-1 "由导入
 * 路径之外的场景触发" (triggered by a scenario outside the import path) -- i.e. something has
 * to be able to report "this asset currently has a blocking gate verdict" WITHOUT that
 * something being the six-gate engine, because that engine does not exist here yet.
 *
 * This port is that something: a single boolean question, answerable today by a phase-1
 * stand-in that always says "no blocking gate" (see
 * `infrastructure/asset/always-passing-asset-gate-status.ts`), and swappable later for a real
 * reader over `uc-23-2`'s `LandingCheck` rows once phase-2 lands -- without `publishAsset.ts`
 * changing at all. Building a fuller `GateVerdict`/`GateRunState` shape (I-9's two-field
 * distinction) here would be reconstructing `uc-23-2`'s domain model one field at a time from
 * this feature's narrower need, which is exactly the kind of "invent the deferred half" this
 * bundle's contract header repeatedly warns against.
 */
export interface AssetGateStatusPort {
  /** `true` = at least one landing-check verdict for this asset is currently blocking (I-5). */
  hasBlockingGate(assetKind: AssetKind, assetId: string): Promise<boolean>;
}

export const ASSET_GATE_STATUS_PORT = Symbol("AssetGateStatusPort");
