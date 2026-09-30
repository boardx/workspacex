/**
 * AG07 —— handoff（委派 / 转交）准入判定（03-agent-role.md R3 ⑨ / E5；契约束 agent-role UC-7 / I-13）。
 *
 * 纯函数、无 IO。一个判定、两个调用点：
 *   - Agent 在 run 内调 `request_handoff`（网关，按该 run **钉住**的版本快照 `delegationPolicy`）；
 *   - 发起人确认时复核（`confirmHandoff`：目标、深度取自请求时冻结在 handoff 行上的快照，
 *     目标 Agent 的已发布 / 启用状态读**当前**事实——确认那一刻目标被停用就不能新开线程）。
 *
 * 判定顺序（每一步失败都不新开线程、原线程继续）：
 *   1. `targetRole ∈ allowedTargets`（精确匹配，不做前缀 / 模糊，不回退到其它角色）；
 *   2. 新深度 = 来源线程深度 + 1，须 ≤ `maxDepth` 且 ≤ `CALL_CHAIN_MAX_DEPTH`（契约只给硬上限 2，
 *      上限的唯一事实源是 `call-chain.ts`，这里不另抄字面量）；
 *   3. 目标角色在本组织有已发布版本；
 *   4. 目标 Agent 未停用。
 */
import { handoffNotAllowedCopy, type HandoffNotAllowedReason } from "@repo/contracts/agent-role";
import { CALL_CHAIN_MAX_DEPTH } from "./call-chain";

/** 原因码的唯一事实源在契约（agent-role）；这里只再导出，不另抄字面量。 */
export type { HandoffNotAllowedReason };

export interface DelegationPolicySnapshot {
  readonly allowedTargets: readonly string[];
  readonly maxDepth: number;
}

/** 目标角色在本组织的解析结果；`null` = 本组织没有这个角色的 Agent。 */
export interface HandoffTargetFact {
  readonly agentId: string;
  readonly published: boolean;
  readonly enabled: boolean;
}

export type HandoffDecision =
  | { readonly ok: true; readonly depth: number }
  | { readonly ok: false; readonly reason: HandoffNotAllowedReason };

/** 冻结字段读回来是 jsonb：形状不对一律按「不允许任何转交」处理（fail closed）。 */
export function parseDelegationPolicy(raw: unknown): DelegationPolicySnapshot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { allowedTargets: [], maxDepth: 0 };
  const r = raw as { allowedTargets?: unknown; maxDepth?: unknown };
  const targets = Array.isArray(r.allowedTargets) ? r.allowedTargets.filter((x): x is string => typeof x === "string") : [];
  const depth = typeof r.maxDepth === "number" && Number.isInteger(r.maxDepth) && r.maxDepth >= 0 ? r.maxDepth : 0;
  return { allowedTargets: targets, maxDepth: depth };
}

export function decideHandoff(input: {
  readonly policy: DelegationPolicySnapshot;
  readonly targetRole: string;
  /** 来源线程的转交深度：普通线程 0；由一次转交新开的线程 = 那次转交的深度。 */
  readonly sourceDepth: number;
  readonly target: HandoffTargetFact | null;
}): HandoffDecision {
  if (!input.policy.allowedTargets.includes(input.targetRole)) return { ok: false, reason: "target_not_in_allowed_targets" };
  const depth = input.sourceDepth + 1;
  if (depth > Math.min(input.policy.maxDepth, CALL_CHAIN_MAX_DEPTH)) return { ok: false, reason: "depth_exceeded" };
  if (!input.target || !input.target.published) return { ok: false, reason: "target_not_published" };
  if (!input.target.enabled) return { ok: false, reason: "target_disabled" };
  return { ok: true, depth };
}

/** 聊天可见的拒绝文案：单一事实源在契约（`handoffNotAllowedCopy`），前端卡片用的是同一份。 */
export function handoffNotAllowedMessage(reason: HandoffNotAllowedReason, targetRole: string): string {
  return handoffNotAllowedCopy(reason, targetRole);
}
