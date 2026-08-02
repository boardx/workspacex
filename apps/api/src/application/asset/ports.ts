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
import type { ReviewClockRecord } from "../../domain/asset/asset-review-clock";

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

/** `RenameAssetFile` (F143)'s successful outcome -- the content record plus its new path. */
export interface AssetRenamedFileRecord extends AssetFileContentRecord {
  readonly path: string;
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
  /**
   * `DeleteAssetFile` (F143) -- removes `path` from the directory, returning the deleted path.
   * `null` = unknown (kind, assetId), or no such path. **This port never sees the root file**:
   * the use case rejects `path === rootFile` with `ROOT_FILE_UNDELETABLE` before calling here
   * (`uc-23-3` I-7) -- the port has no opinion of its own on which path is the root.
   */
  deleteFile(assetKind: AssetKind, assetId: string, path: string): Promise<string | null>;
  /**
   * `RenameAssetFile` (F143) -- moves `from` to `to`, returning the record at its new path.
   * `null` = unknown (kind, assetId), or `from` does not exist. **Never sees the root file
   * as `from`** -- same gate as `deleteFile`, checked by the use case (renaming the root is
   * defined as equivalent to deleting it, per the contract's own note on `renameAssetFile`).
   */
  renameFile(assetKind: AssetKind, assetId: string, from: string, to: string): Promise<AssetRenamedFileRecord | null>;
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

/**
 * `ReviewClockRepository` -- F138's seam for the `uc-23-6` review clock (`ReviewClockRecord`,
 * `domain/asset/asset-review-clock.ts`).
 *
 * 🔴 **F139 (scan-based downgrade) and F140 (visibility write path + orphaned-asset handoff)
 * both read/write through this SAME port.** `listActive` is intentionally not scoped to "due
 * ones only" -- it hands back every `active`-state clock so F139's scan can decide, using the
 * domain's `isReviewDue` predicate, without this port needing to know what "due" means for a
 * second, wider sweep (e.g. a future re-check across `pending-review` records too). Do not
 * narrow this to `listDue(nowIso)` without checking whether F139 already depends on the wider
 * shape.
 *
 * 🔴 **F139 adds `listPendingReview`** for its own sweep (T2, `pending-review -> downgraded`).
 * `listActive` structurally cannot serve T2: by the time a clock is `pending-review`, T1 has
 * already moved it OUT of the `active` set `listActive` returns, so a scan that only called
 * `listActive` would never see it again -- exactly the "second read that quietly can't reach
 * the records it needs" shape this port's own history (see `listActive`'s comment above) warns
 * against repeating. Same reasoning as `listActive`: hands back every `pending-review` clock,
 * not just ones already past `downgradeDueAt` -- the domain's `isDowngradeDue` predicate decides
 * "due" so this port does not have to.
 */
export interface ReviewClockRepository {
  /** `null` = no clock has ever been recorded for this (kind, assetId) -- i.e. never published. */
  get(assetKind: AssetKind, assetId: string): Promise<ReviewClockRecord | null>;
  save(record: ReviewClockRecord): Promise<void>;
  /** Every clock currently in `active` state, across all assets in scope for this repository. */
  listActive(): Promise<readonly ReviewClockRecord[]>;
  /** Every clock currently in `pending-review` state -- F139's T2 sweep input. */
  listPendingReview(): Promise<readonly ReviewClockRecord[]>;
}

export const REVIEW_CLOCK_REPOSITORY = Symbol("ReviewClockRepository");

/**
 * `AssetRuntimeLoaderPort` -- F143's seam for domain I-6 (`uc-23-3` R7 rule 1 / R12-11):
 * "目录结构就是发布出去的结构" -- **there is no separate packaging step**. What runtime
 * loads for a published asset must be answerable from the SAME kind of question
 * `GetAssetDirectory` answers, not a second store that could silently drift from it.
 *
 * ⚠ **This is why the phase-1 implementation
 * (`infrastructure/asset/directory-backed-asset-runtime-loader.ts`) delegates straight to
 * `AssetFileRepository.getDirectory`** -- that is not a shortcut, it is the fix the rule
 * demands: an implementation where the loaded set and the directory listing are read from
 * one place cannot drift, because there is only one place. A future real runtime (one that
 * actually executes a skill/agent) must still answer this same question from whatever it
 * loads bytes from -- and `domain/asset/runtime-load-set.ts`'s comparison function is what
 * catches it if that future implementation's answer ever stops matching the directory.
 */
export interface AssetRuntimeLoaderPort {
  /** `null` = same collapsed not-found outcome as `AssetFileRepository.getDirectory`. */
  loadedFilePaths(assetKind: AssetKind, assetId: string): Promise<readonly string[] | null>;
}

export const ASSET_RUNTIME_LOADER_PORT = Symbol("AssetRuntimeLoaderPort");

/**
 * `AssetOwnerStatusPort` -- F140's seam for `uc-23-6` E1 ("负责人离职 / 账号停用").
 *
 * 🔴 **This answers exactly one question and invents nothing else.** E1's own text says the
 * fallback takeover person is `[待确认]` -- there is no ruling on WHO takes over an orphaned
 * asset, only on the fact that it needs to be surfaced (`ASSET_DOWNGRADED_OWNER_MISSING` +
 * a takeover entry point). This port lets `getAssetOrphanStatus` ask "is this owner's account
 * deactivated" without that use case reaching into `identity`'s membership machinery itself
 * (which has no "deactivated" concept today -- see `always-active-asset-owner-status.ts`'s own
 * header for why the phase-1 stand-in always answers "no").
 */
export interface AssetOwnerStatusPort {
  /** `true` = the owner's org account has been deactivated (uc-23-6 E1). */
  isOwnerDeactivated(ownerId: string): Promise<boolean>;
}

export const ASSET_OWNER_STATUS_PORT = Symbol("AssetOwnerStatusPort");
