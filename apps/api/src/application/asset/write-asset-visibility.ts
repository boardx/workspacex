/**
 * `writeAssetGovernanceVisibility` -- F135 (`uc-23-4` R7 rule 1 / R3 第一项, domain I-14).
 *
 * 🔴 **This is the ONLY place in this bundle that calls `AssetGovernanceRepository.set` to
 * change an asset's `visibility`.** `uc-23-4` domain I-14 requires that a later automatic
 * downgrade (`uc-23-6`'s 30-day-no-review path, F138/F139 -- not built yet) go through the
 * SAME server-side write path as a human editing the governance panel, not a second function
 * that happens to write the same row. `assertOnlyWriteSite.test.ts`-style source scanning
 * (see `apps/api/tests/asset/visibility-single-write-path.test.ts`) enforces this by grepping
 * `src/application/asset` and `src/domain/asset` for any OTHER call site of
 * `governance.set(` / `.governance.set(` -- there must be exactly one, and it must be here.
 *
 * ⚠ The assertion this exists to satisfy is "the same function got called", not "the two
 * writes look alike" (per the feature's own notes): two independently-written call sites that
 * happen to persist the same fields today will silently diverge the moment either one grows a
 * side effect the other forgets (an audit write, a cache bust, a search-index refresh). Routing
 * every visibility write through one function makes that divergence structurally impossible
 * instead of merely absent today.
 *
 * ⚠ **Does not invent the cosign approval workflow.** `requiresCosign: true` is the one bit
 * `uc-23-4` A1 authorizes this bundle to surface -- who the 领域负责人 is, where they act, how
 * long before timeout, is `[待确认]` (issue #252 notes). Inventing a persisted "pending cosign"
 * status field here would be building that undocumented approval flow through the back door;
 * this function stores the governance the caller asked for and reports the one confirmed fact
 * (whether cosign is required), nothing more.
 *
 * ⚠ Whether F139's future downgrade may pass a partial change (e.g. only `visibility` +
 * `teamIds`, keeping the rest of an existing record) is for that feature to decide when it
 * exists; this function's contract is "persist exactly the `AssetGovernanceRecord` you hand
 * it and report whether it is (now) `whole-org`" -- it does not merge partial input, callers
 * build the full record they want written (same as `setAssetGovernance` does today).
 */
import type { AssetGovernanceRecord, AssetGovernanceRepository, AssetKind } from "./ports";

export interface WriteAssetGovernanceVisibilityDeps {
  readonly governance: AssetGovernanceRepository;
}

export interface WriteAssetGovernanceVisibilityResult {
  readonly record: AssetGovernanceRecord;
  /** `true` ⟺ `record.visibility === "whole-org"` -- see header on why this stays a bare bit. */
  readonly requiresCosign: boolean;
}

export async function writeAssetGovernanceVisibility(
  deps: WriteAssetGovernanceVisibilityDeps,
  assetKind: AssetKind,
  assetId: string,
  record: AssetGovernanceRecord,
): Promise<WriteAssetGovernanceVisibilityResult> {
  await deps.governance.set(assetKind, assetId, record);
  return { record, requiresCosign: record.visibility === "whole-org" };
}
