/**
 * F56 / O-21 / I-28 / I-29 -- the dual gate on `批准发布`: automated security scan +
 * methodology review, both required, neither substitutable for the other, plus the
 * elevation-request countersign gate (I-29) and the whitelist gate (I-28) already proven by
 * F55's `checkWhitelistConfigured`.
 *
 * ## Why `submitAgentForReview` and `decideAgentPublish` both re-check the whitelist
 *
 * `checkWhitelistConfigured` (F55, `lifecycle.ts`) is the single source of I-28. It is called
 * from BOTH gates here rather than once, because the whitelist can be emptied (e.g. an MCP
 * server the whitelist referenced gets deleted) between submission and the reviewer's
 * decision -- "服务端在提交时即阻断；直接调接口置为运行中亦被拒" (user_visible_behavior)
 * reads as two separate enforcement points, not one check whose result is trusted later.
 *
 * ## Why `decideAgentPublish`'s gates run in a fixed order
 *
 * `WRONG_REVIEW_FUNCTION` / `SELF_REVIEW_FORBIDDEN` come first: they are about WHO is asking,
 * and answering "no" to the wrong person should not first leak WHAT is wrong with the agent.
 * The three "is the agent itself ready" checks follow in the order the contract's `err` array
 * lists them (`SECURITY_SCAN_PENDING | METHODOLOGY_REVIEW_PENDING | ELEVATION_UNDECIDED |
 * TOOL_WHITELIST_EMPTY`) so that a caller fixing issues one at a time sees them in a stable
 * sequence rather than whichever the object's key order happens to produce.
 */
import type { ToolWhitelistEntryT } from "./definition";
import { checkWhitelistConfigured } from "./lifecycle";
import type { ReviewFunction } from "./elevation-review";

export interface AgentPublishGateInput {
  readonly agent: { readonly toolWhitelist: readonly ToolWhitelistEntryT[] };
  readonly submitterId: string;
  readonly actorId: string;
  readonly actorFunction: ReviewFunction;
  readonly decision: "批准发布" | "退回";
  readonly securityScanPassed: boolean;
  /**
   * Whether an automated methodology check ran (distinct from THIS call being the human
   * methodology reviewer's verdict) -- e.g. a linting pass over the agent definition. `true`
   * unless the caller has a reason to withhold it; `批准发布` itself IS the human half of
   * methodology review, so this is deliberately a narrow, separately-named gate rather than a
   * duplicate of the decision being made.
   */
  readonly methodologyPrecheckPassed: boolean;
}

export type AgentPublishGateResult =
  | { readonly ok: true; readonly publishState: "运行中" | "草稿" }
  | {
      readonly ok: false;
      readonly reason:
        | "WRONG_REVIEW_FUNCTION"
        | "SELF_REVIEW_FORBIDDEN"
        | "SECURITY_SCAN_PENDING"
        | "METHODOLOGY_REVIEW_PENDING"
        | "ELEVATION_UNDECIDED"
        | "TOOL_WHITELIST_EMPTY";
    };

/**
 * `[批准发布]` / `[退回]` (UC-4.1 R3 步骤 10).
 *
 * ⚠ Only a `methodologyReviewer` may call this -- a `securityReviewer` (or `orgAdmin`, who is
 * eligible for elevation countersigns but NOT for this decision) gets `WRONG_REVIEW_FUNCTION`.
 * This is the reverse pairing of `decideElevationRequest`'s gate, and the two functions must
 * never both accept the same actor for the same matter (O-21).
 */
export function decideAgentPublish(input: AgentPublishGateInput): AgentPublishGateResult {
  if (input.actorFunction !== "methodologyReviewer") {
    return { ok: false, reason: "WRONG_REVIEW_FUNCTION" };
  }
  if (input.actorId === input.submitterId) {
    return { ok: false, reason: "SELF_REVIEW_FORBIDDEN" };
  }

  if (input.decision === "退回") {
    // Rejection does not need the agent to be ready -- that is exactly what is being said no
    // to. No further gates apply.
    return { ok: true, publishState: "草稿" };
  }

  if (!input.securityScanPassed) return { ok: false, reason: "SECURITY_SCAN_PENDING" };
  if (!input.methodologyPrecheckPassed) return { ok: false, reason: "METHODOLOGY_REVIEW_PENDING" };

  const pendingElevation = input.agent.toolWhitelist.some(
    (e) => e.state === "越权申请待确认",
  );
  if (pendingElevation) return { ok: false, reason: "ELEVATION_UNDECIDED" };

  const whitelistGate = checkWhitelistConfigured(input.agent);
  if (!whitelistGate.ok) return { ok: false, reason: whitelistGate.reason };

  return { ok: true, publishState: "运行中" };
}

/**
 * `submitAgentForReview` (UC-4.1 R3 步骤 9) -- the FIRST enforcement point of I-28.
 *
 * ⚠ Direct-API-bypass proof: this is the only legal way `publishState` moves from `草稿` to
 * `待审核`, and it refuses before anything else runs. There is deliberately no code path in
 * this bundle that can move an agent to `运行中` except through `decideAgentPublish` above --
 * see `agent-runtime.ts`'s `updateAgentDefinition.in.patch` schema, which has no
 * `publishState` field at all (asserted in `whitelist-required-to-publish.test.ts`), so a
 * "直接调接口置为运行中" attempt has no field to carry that value through even before this
 * gate is reached.
 */
export function submitAgentForReview(
  agent: { readonly toolWhitelist: readonly ToolWhitelistEntryT[] },
): { readonly ok: true; readonly publishState: "待审核" } | { readonly ok: false; readonly reason: "TOOL_WHITELIST_EMPTY" } {
  const gate = checkWhitelistConfigured(agent);
  if (!gate.ok) return { ok: false, reason: gate.reason };
  return { ok: true, publishState: "待审核" };
}
