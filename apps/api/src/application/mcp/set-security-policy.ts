/**
 * `setSecurityPolicy` -- F54 (UC-21.2 R7 / E3 / E4 / R12 V2 / V2a): 四开关的写路径.
 *
 * ## 写入顺序：先留痕、后落库
 *
 * R7 逐字「策略变更……都必须记录审计事件」，E3/E4 逐字「关闭动作本身写入审计与
 * `provenance_events`」。这里选择**先 `provenance.append`、成功后才真正切换开关**，
 * 而不是反过来——理由与"没有留痕就没有调用"（R3 步骤 6 的硬前置）同构：一次策略变更如果
 * 留痕失败却仍然生效，就产生了"策略已经变了、但审计查不到是谁在什么时候改的"的窗口，
 * 这正是本用例存在的意义要防止的事。`provenance.append` 抛错时，`policyStore.set` 完全
 * 不会被调用——调用方看到的是一个失败的 promise，而不是"部分生效"。
 */
import type { SecurityPolicy } from "@repo/contracts/agent-runtime";
import type { z } from "zod";
import {
  evaluateSecurityPolicySwitchChange,
  type PolicySwitchNo,
} from "../../domain/mcp/security-policy";
import type { ProvenanceWriter } from "../provenance/ports";
import type { SecurityPolicyStore } from "./ports";
import type { OrgId } from "../../domain/org-id";

export type SecurityPolicyT = z.infer<typeof SecurityPolicy>;

export interface SetSecurityPolicyDeps {
  readonly policyStore: SecurityPolicyStore;
  readonly provenance: ProvenanceWriter;
}

export interface SetSecurityPolicyInput {
  readonly orgId: OrgId;
  readonly switchNo: PolicySwitchNo;
  readonly enabled: boolean;
  readonly confirmToken: string | null;
  readonly actorId: string;
}

export class PolicySwitchLockedError extends Error {
  readonly reason = "POLICY_SWITCH_LOCKED" as const;
  constructor(readonly detail: string) {
    super(detail);
  }
}

const FIELD_BY_SWITCH = {
  1: "isolateNewServers",
  2: "logCustomerDataCalls",
  3: "confidentialLocalOnly",
  4: "agentSelfDiscoversMcp",
} as const satisfies Record<PolicySwitchNo, keyof SecurityPolicyT>;

export async function setSecurityPolicy(
  deps: SetSecurityPolicyDeps,
  input: SetSecurityPolicyInput,
): Promise<SecurityPolicyT> {
  const check = evaluateSecurityPolicySwitchChange({
    switchNo: input.switchNo,
    enabled: input.enabled,
    hasConfirmToken: input.confirmToken !== null && input.confirmToken.trim().length > 0,
  });
  if (!check.ok) {
    throw new PolicySwitchLockedError(check.detail);
  }

  const current = await deps.policyStore.get();
  const field = FIELD_BY_SWITCH[input.switchNo];
  const next = { ...current, [field]: input.enabled } as SecurityPolicyT;

  // 先留痕，后落库——留痕失败则本次策略变更整体不生效（R7）。
  await deps.provenance.append({
    orgId: input.orgId,
    type: "capability-updated",
    actorId: input.actorId,
    target: { kind: "capability", id: "mcp-security-policy" },
    detail: {
      switchNo: input.switchNo,
      field,
      from: current[field],
      to: input.enabled,
      confirmed: input.confirmToken !== null,
    },
  });

  await deps.policyStore.set(next);
  return next;
}
