/**
 * F56 -- the three-layer permission INTERSECTION (I-27 / O-23), the fact `authorizeToolCall`
 * and `explainEffectivePermission` are both projections of.
 *
 * `有效权限 = ① MCP 授权范围 ∩ ② agent 工具白名单 ∩ ③ 任务权限包 R1/R2/R3`
 *
 * ## Why this is a pure function over three pre-computed booleans, not three I/O calls
 *
 * Layer ① is already decided by `authorizeMcpScopeLayer1` (F53). Layer ③ lives in
 * 00-core/11-board (X-1, out of this bundle's scope -- `usecases.md` is explicit that this
 * bundle only EXPOSES the request endpoint for it, `requestTaskPermissionGrant`). What this
 * bundle owns is the MERGE rule: given what each layer already decided, is the call allowed,
 * and if not, which single layer is the one to blame. That merge is a total function of three
 * facts and nothing else -- no clock, no repository -- which is exactly what lets I-27's
 * "no lower layer may loosen an upper layer" be asserted without standing up Postgres or an
 * MCP server.
 *
 * ## Why `deniedBy` is "the FIRST layer that denies", not "every layer that denies"
 *
 * `explainEffectivePermission`'s `deniedBy` is typed `1 | 2 | 3 | null` -- a single layer, not
 * a set. Picking anything other than layer order (①→②→③) would make two runs with the same
 * three inputs report different `deniedBy` depending on object key order, which is precisely
 * the kind of non-determinism a "why was I refused" explanation cannot have. Layer order was
 * chosen (rather than, say, "most restrictive first") because it matches the order the
 * contract itself lists the layers in, and because layer ① is the one a security reviewer
 * would check first in the actual UI (MCP scope is org-wide policy; whitelist and task
 * package are per-agent/per-task).
 */
import type { ToolWhitelistEntryT } from "./definition";

/** What layer ① has already decided, upstream of this module (F53's `authorizeMcpScopeLayer1`). */
export interface Layer1Fact {
  readonly granted: boolean;
}

/** What layer ③ (task permission package, 00-core/11-board, X-1) has already decided. */
export interface Layer3Fact {
  readonly granted: boolean;
  readonly taskId: string | null;
}

export interface ThreeLayerInput {
  readonly layer1: Layer1Fact;
  /** The single whitelist entry naming the tool being called. `null` = not whitelisted at all. */
  readonly whitelistEntry: ToolWhitelistEntryT | null;
  readonly layer3: Layer3Fact;
}

export interface ThreeLayerResult {
  readonly allowed: boolean;
  /** Which layers, independently, would grant -- present even when the overall result denies. */
  readonly layer1: { readonly granted: boolean };
  readonly layer2: { readonly granted: boolean; readonly state: string };
  readonly layer3: { readonly granted: boolean; readonly taskId: string | null };
  /** Layers that actually contributed to an ALLOW. Empty when denied. */
  readonly grantingLayers: readonly ("mcp-scope" | "whitelist" | "task-package")[];
  /** The first layer (in ①→②→③ order) that denies. `null` when allowed. */
  readonly deniedBy: 1 | 2 | 3 | null;
}

/**
 * Layer ②'s own verdict on one whitelist entry.
 *
 * ⚠ `已准` alone is not enough -- I-29 requires BOTH countersignatures (security reviewer +
 * org admin) before an elevated entry is effective. A `已准` entry whose `elevationDecision`
 * is missing a signature is a data-integrity violation this function refuses to treat as
 * granted (see `elevation-review.ts`'s `auditElevationEntryCompliance` for the audit-facing
 * half of that same rule).
 *
 * ⚠ `签名已变更需重新确认` (I-22) is NOT granted -- a changed MCP tool signature must be
 * re-confirmed before the entry is usable again, even though the entry once passed review.
 */
export function whitelistEntryGrants(entry: ToolWhitelistEntryT | null): boolean {
  if (entry === null) return false;
  switch (entry.state) {
    case "在授权范围内":
      return true;
    case "已准":
      return (
        entry.elevationDecision !== null &&
        entry.elevationDecision.securityReviewerSig !== null &&
        entry.elevationDecision.orgAdminSig !== null
      );
    case "越权申请待确认":
    case "已否":
    case "签名已变更需重新确认":
      return false;
  }
}

/**
 * The single merge point (I-27 / O-23). Every one of the three layers must independently
 * grant; the first one (in ①→②→③ order) that does not is reported as `deniedBy`.
 *
 * ⚠ This is intersection, not "most permissive wins" -- a caller that only checks layer ① and
 * assumes ② and ③ inherit the same answer is exactly the "下层放宽上层" bug I-27 forbids. The
 * three facts are required arguments, not defaulted, so a call site cannot forget to fetch one.
 */
export function intersectAgentPermission(input: ThreeLayerInput): ThreeLayerResult {
  const layer2Granted = whitelistEntryGrants(input.whitelistEntry);
  const layer2State = input.whitelistEntry?.state ?? "越权申请待确认";

  const layer1 = { granted: input.layer1.granted };
  const layer2 = { granted: layer2Granted, state: layer2State };
  const layer3 = { granted: input.layer3.granted, taskId: input.layer3.taskId };

  let deniedBy: 1 | 2 | 3 | null = null;
  if (!layer1.granted) deniedBy = 1;
  else if (!layer2.granted) deniedBy = 2;
  else if (!layer3.granted) deniedBy = 3;

  const allowed = deniedBy === null;
  const grantingLayers: ("mcp-scope" | "whitelist" | "task-package")[] = [];
  if (allowed) {
    grantingLayers.push("mcp-scope", "whitelist", "task-package");
  }

  return { allowed, layer1, layer2, layer3, grantingLayers, deniedBy };
}
