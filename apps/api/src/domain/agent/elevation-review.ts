/**
 * F56 / O-21 / I-26 / I-29 -- 越权申请的逐条裁决与双签会签.
 *
 * ## The two functions this bundle refuses to let collapse into one
 *
 * `方法论审核人` (methodology reviewer) judges whether the AGENT's definition is sound --
 * role, skill mounts, method. `安全评审人` (security reviewer) judges whether a SPECIFIC
 * over-scope tool request should be granted -- and because granting it widens layer ①'s MCP
 * authorization surface, an org admin must co-sign. A methodology reviewer attempting to
 * decide an elevation request is not "the wrong person doing the right job" -- it is the
 * WRONG JOB, and the contract's own error name says so: `WRONG_REVIEW_FUNCTION`, not
 * `ROLE_INSUFFICIENT`. Both functions may be held by the same natural person, but never
 * exercised on the same matter (R5, verbatim).
 *
 * ## Why rejection is single-signature but approval is not
 *
 * Approving an elevated entry EXPANDS what layer ① effectively allows for this agent -- that
 * is precisely the action O-21 requires two independent signatures for. Rejecting one does
 * not expand anything; it leaves the tool unusable, which is the same outcome as never having
 * requested it. Requiring a second signature to say "no" a second time would be security
 * theatre with no corresponding risk to gate, so a single `否` from either eligible function
 * is final.
 */
import { CountersignRole, ElevationVerdict } from "@repo/contracts/agent-runtime";
import type { z } from "zod";
import type { ToolWhitelistEntryT } from "./definition";

type CountersignRoleT = z.infer<typeof CountersignRole>;
type ElevationVerdictT = z.infer<typeof ElevationVerdict>;

/** The functional roles a natural person can hold. Only two may countersign (O-21). */
export type ReviewFunction = "methodologyReviewer" | "securityReviewer" | "orgAdmin";

export interface ElevationDecisionInput {
  readonly toolFullName: string;
  readonly verdict: ElevationVerdictT;
  readonly reason: string;
  /** The signer's ACTUAL assigned function -- never trusted from `signature.role` alone. */
  readonly actorFunction: ReviewFunction;
  readonly actorId: string;
  /** The claimed signing role. Must be consistent with `actorFunction` (see below). */
  readonly signatureRole: CountersignRoleT;
}

export type ElevationDecisionError =
  | { readonly ok: false; readonly reason: "WRONG_REVIEW_FUNCTION" }
  | { readonly ok: false; readonly reason: "SELF_REVIEW_FORBIDDEN" }
  | { readonly ok: false; readonly reason: "REVIEW_REASON_REQUIRED" };

export type ElevationDecisionResult =
  | {
      readonly ok: true;
      readonly entry: ToolWhitelistEntryT;
    }
  | ElevationDecisionError;

/**
 * Apply ONE countersignature (or a rejection) to a whitelist entry.
 *
 * ⚠ `actorFunction` is the caller-verified fact of who is actually signing -- a
 * `methodologyReviewer` cannot make this call grant by claiming `signatureRole: "orgAdmin"` in
 * the request body, because the function-eligibility check runs on `actorFunction`, and
 * `signatureRole` is additionally required to MATCH one of the two eligible functions (a
 * `securityReviewer` cannot sign as `orgAdmin` and vice versa -- that would let one person's
 * single signature masquerade as the two-signature countersign O-21 demands).
 */
export function decideElevationRequest(
  entry: ToolWhitelistEntryT,
  submitterId: string,
  input: ElevationDecisionInput,
): ElevationDecisionResult {
  // ① Function eligibility -- methodology reviewer is not in {securityReviewer, orgAdmin}.
  if (input.actorFunction === "methodologyReviewer") {
    return { ok: false, reason: "WRONG_REVIEW_FUNCTION" };
  }
  // A securityReviewer cannot sign as orgAdmin (and vice versa) -- one person's function must
  // match the countersign slot they are filling.
  if (input.actorFunction !== input.signatureRole) {
    return { ok: false, reason: "WRONG_REVIEW_FUNCTION" };
  }

  // ② Never the submitter (I-26 / R5: 审核人/评审人 ≠ 提交人).
  if (input.actorId === submitterId) {
    return { ok: false, reason: "SELF_REVIEW_FORBIDDEN" };
  }

  // ③ Reason is not optional -- review conclusions must be recoverable.
  if (input.reason.trim().length === 0) {
    return { ok: false, reason: "REVIEW_REASON_REQUIRED" };
  }

  const priorSecuritySig =
    entry.elevationDecision?.securityReviewerSig ?? null;
  const priorOrgAdminSig = entry.elevationDecision?.orgAdminSig ?? null;

  if (input.verdict === "否") {
    // A single eligible signer rejecting is final -- see header for why this is NOT symmetric
    // with approval.
    return {
      ok: true,
      entry: {
        ...entry,
        state: "已否",
        elevationDecision: {
          verdict: "否",
          reason: input.reason,
          securityReviewerSig: input.actorFunction === "securityReviewer" ? input.actorId : priorSecuritySig,
          orgAdminSig: input.actorFunction === "orgAdmin" ? input.actorId : priorOrgAdminSig,
        },
      },
    };
  }

  // verdict === "准": merge this signature into whichever slot the signer fills.
  const securityReviewerSig =
    input.actorFunction === "securityReviewer" ? input.actorId : priorSecuritySig;
  const orgAdminSig = input.actorFunction === "orgAdmin" ? input.actorId : priorOrgAdminSig;
  const bothSigned = securityReviewerSig !== null && orgAdminSig !== null;

  return {
    ok: true,
    entry: {
      ...entry,
      // ⚠ Stays `越权申请待确认` until BOTH signatures are present (I-29) -- a single
      // signature does not flip the entry to `已准`, and therefore does not grant layer ②
      // (see `three-layer-permission.ts`'s `whitelistEntryGrants`).
      state: bothSigned ? "已准" : "越权申请待确认",
      elevationDecision: {
        verdict: "准",
        reason: input.reason,
        securityReviewerSig,
        orgAdminSig,
      },
    },
  };
}

/**
 * The audit-facing half of I-29: an entry that CLAIMS `已准` but is missing either signature
 * is a "流程不合规" (process non-compliant) record, and `COUNTERSIGN_MISSING` is the code
 * that names it.
 *
 * ⚠ `decideElevationRequest` above never PRODUCES such an entry (it holds the state at
 * `越权申请待确认` until both signatures land) -- this function exists for the case the
 * contract itself calls out: a record that reaches `已准` some other way (a migrated row, a
 * direct write, a bug) must still be caught and reported as non-compliant rather than treated
 * as a valid grant. `whitelistEntryGrants` already refuses to grant such an entry; this
 * function is what lets the audit VIEW explain why.
 */
export function auditElevationEntryCompliance(
  entry: ToolWhitelistEntryT,
): { readonly ok: true } | { readonly ok: false; readonly reason: "COUNTERSIGN_MISSING" } {
  if (entry.state !== "已准") return { ok: true };
  const decision = entry.elevationDecision;
  const bothSigned =
    decision !== null && decision.securityReviewerSig !== null && decision.orgAdminSig !== null;
  return bothSigned ? { ok: true } : { ok: false, reason: "COUNTERSIGN_MISSING" };
}
