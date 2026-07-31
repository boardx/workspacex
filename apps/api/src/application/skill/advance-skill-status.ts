/**
 * 状态机推进的**唯一用例**（F61）。
 *
 * 所有 `Skill.status` 的改变都从这里过；`interface` 层不许自己写状态。
 * 这不是洁癖：契约的 `SKILLS_FORBIDDEN_ROUTES` 逐字禁止 `POST /skills/:id/enable`，
 * 理由是「一条直达的启用路由就是那条绕过路径本身」。一个状态机若有第二个写入口，
 * 那个入口就是同一条直达路由，只是没写在路由表上。
 *
 * ⚠ 绕过尝试**写安全审计**（I-23）：拒绝而不留痕，事后与「从未发生」不可区分。
 */
import {
  authorizeStatusTransition,
  type GateState,
} from "../../domain/skill/security-gate";
import type { SkillErrorCode } from "../../domain/skill/declarative-contract";
import type { SkillLifecycleStatus } from "../../domain/skill/skill-status";
import type { SecurityAuditPort } from "./ports";

export interface AdvanceSkillStatusInput {
  readonly skillId: string;
  readonly principalId: string;
  readonly from: SkillLifecycleStatus;
  readonly to: SkillLifecycleStatus;
  readonly gates: GateState;
}

export type AdvanceSkillStatusResult =
  | { readonly ok: true; readonly status: SkillLifecycleStatus }
  | {
      readonly ok: false;
      readonly code: SkillErrorCode;
      readonly reason: string;
      /** 状态**没有**改变。显式返回，好让测试断言行为而不是断言错误码 */
      readonly status: SkillLifecycleStatus;
      readonly auditWritten: boolean;
    };

export async function advanceSkillStatus(
  input: AdvanceSkillStatusInput,
  deps: { readonly audit: SecurityAuditPort },
): Promise<AdvanceSkillStatusResult> {
  const verdict = authorizeStatusTransition({
    from: input.from,
    to: input.to,
    gates: input.gates,
  });

  if (verdict.allowed) {
    return { ok: true, status: input.to };
  }

  // I-23：只有「试图跳过门禁」才是安全事件；「这条边不存在」是并发/手滑，不进安全审计。
  const isBypass = verdict.code === "GATE_NOT_PASSED";
  if (isBypass) {
    await deps.audit.record({
      kind: "skill-gate-bypass-attempt",
      principalId: input.principalId,
      detail: `${input.skillId}: ${input.from} → ${input.to} —— ${verdict.reason ?? ""}`,
    });
  }

  return {
    ok: false,
    code: verdict.code ?? "GATE_NOT_PASSED",
    reason: verdict.reason ?? "",
    status: input.from,
    auditWritten: isBypass,
  };
}
