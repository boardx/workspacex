/**
 * 恢复（F66；契约 `restoreSkill`，UC-3.4 R3 分支 B 步骤 9、AC「V8」）。
 *
 * ⚠ 恢复 = `已停用 → 已启用`，同样借道 `advanceSkillStatus`——不新开状态机边。
 * ⚠ **历史引用不受恢复影响**：本函数不碰任何绑定/挂载记录，只改 `Skill.status`
 *   这一个字段。锁定版本的现场解析（`resolveBoundVersion`）压根不读 `Skill.status`，
 *   所以「历史引用不受影响」在这里是**结构性**的——它不需要一条额外的断言,
 *   因为没有代码路径能够把恢复动作和已解析出的历史版本连起来。
 */
import { advanceSkillStatus, type AdvanceSkillStatusResult } from "./advance-skill-status";
import type { SecurityAuditPort } from "./ports";

export interface RestoreSkillInput {
  readonly skillId: string;
  readonly principalId: string;
}

type AdvanceFailure = Extract<AdvanceSkillStatusResult, { readonly ok: false }>;

export type RestoreSkillResult =
  | { readonly ok: true; readonly status: "已启用" }
  | { readonly ok: false; readonly code: AdvanceFailure["code"] };

export async function restoreSkill(
  input: RestoreSkillInput,
  deps: { readonly audit: SecurityAuditPort },
): Promise<RestoreSkillResult> {
  const transition = await advanceSkillStatus(
    {
      skillId: input.skillId,
      principalId: input.principalId,
      from: "已停用",
      to: "已启用",
      gates: { scan: null, methodologyReview: null, acknowledgedRiskItemIds: [] },
    },
    { audit: deps.audit },
  );

  if (!transition.ok) return { ok: false, code: transition.code };
  return { ok: true, status: "已启用" };
}
