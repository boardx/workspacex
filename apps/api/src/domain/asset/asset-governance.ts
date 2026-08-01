/**
 * `assetGovernanceMissingFields` -- F134 (`uc-23-4` R3, domain I-10 / I-11).
 *
 * Pure predicate over an in-flight `AssetGovernance` payload: which of the four fields
 * (`visibility` / `editableBy` / `ownerId` / `reviewCycle`) are missing, so the caller can be
 * told exactly which one -- not a blanket "配置不完整" (the feature's whole user-visible point,
 * per `uc-23-4` R7 rule 1 / domain I-10). Only a missing-field *name*, never a value, crosses
 * this boundary -- the point is precision about WHICH slot is empty, not echoing input back.
 *
 * ⚠ Applies identically to all six `AssetKind`s (Q-1b's "unified" reading, `KNOWN_CONTRACT_GAPS.AG1`)
 * -- this function does not take `assetKind` as a parameter at all, which IS the "six kinds are
 * exactly the same" assertion made mechanically checkable: there is no branch here that could
 * treat one kind differently from another.
 *
 * ⚠ Exactly **four** field names can come out of this, never five: `visibility = "specified-teams"`
 * without a non-empty `teamIds` is folded into the `"visibility"` entry (an incomplete choice of
 * visibility), not a separate `"teamIds"` entry -- `uc-23-4` domain I-10 counts four fields, and
 * inventing a fifth would contradict the feature's own acceptance line ("四个字段各造一次缺失").
 */

export type AssetVisibilityValue = "specified-teams" | "whole-org" | "private-draft";
export type ReviewCycleValue = "6m" | "12m" | "24m";

/** What the caller sent -- every field optional because "missing" is exactly what this checks. */
export interface AssetGovernanceDraft {
  readonly visibility?: AssetVisibilityValue;
  readonly teamIds?: readonly string[];
  readonly editableBy?: readonly string[];
  readonly ownerId?: string;
  readonly reviewCycle?: ReviewCycleValue;
}

/** The four -- and only four -- top-level fields I-10 requires. Order is the report order. */
export type GovernanceField = "visibility" | "editableBy" | "ownerId" | "reviewCycle";

export const GOVERNANCE_FIELDS: readonly GovernanceField[] = ["visibility", "editableBy", "ownerId", "reviewCycle"];

export function assetGovernanceMissingFields(draft: AssetGovernanceDraft): GovernanceField[] {
  const missing: GovernanceField[] = [];

  if (draft.visibility === undefined) {
    missing.push("visibility");
  } else if (draft.visibility === "specified-teams" && (draft.teamIds === undefined || draft.teamIds.length === 0)) {
    // Folded into "visibility" -- see the header on why this is not a fifth field name.
    missing.push("visibility");
  }

  if (draft.editableBy === undefined || draft.editableBy.length === 0) missing.push("editableBy");
  if (draft.ownerId === undefined || draft.ownerId.trim().length === 0) missing.push("ownerId");
  if (draft.reviewCycle === undefined) missing.push("reviewCycle");

  return missing;
}
