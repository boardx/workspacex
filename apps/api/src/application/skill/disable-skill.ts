/**
 * 停用（F66；契约 `disableSkill`，UC-3.4 R3 分支 B 步骤 7、AC1）。
 *
 * ⚠ **无清单不得停用**（R7）：`referenceSnapshotId` 必须是这个 skill **最新一次**
 *   `listReferences` 产出的那个 id，而不是任意一个曾经存在过的 id——
 *   否则「拿一份很久以前的空清单去停用一个此刻一堆项目正在用的 skill」就会放行。
 * ⚠ 状态迁移本身复用 F61 的 `advanceSkillStatus`（`已启用 → 已停用` 已在那条状态机里），
 *   不重开第二条写路径——`SKILLS_FORBIDDEN_ROUTES` 的纪律同样适用于这里。
 * ⚠ **CC（内置）允许停用**，只是不允许硬删——I-13 与本函数**不**互相排斥，
 *   所以这里没有任何 `source` 判断；那条判断只属于 `hard-delete-skill.ts`。
 */
import type { z } from "zod";
import { skills } from "@repo/contracts";
import { advanceSkillStatus, type AdvanceSkillStatusResult } from "./advance-skill-status";
import { isReferenceSnapshotFresh } from "../../domain/skill/reference-enumeration";
import type { SkillLifecycleStatus } from "../../domain/skill/skill-status";
import type { SecurityAuditPort } from "./ports";
import type { ReferenceSnapshotStorePort } from "./ports";

/** 从契约派生，**不重写**（ADR-020）——`disableSkill.in.mode` 就是这个枚举。 */
export type DisableMode = z.infer<typeof skills.DisableMode>;

export interface DisableSkillInput {
  readonly skillId: string;
  readonly principalId: string;
  readonly referenceSnapshotId: string;
  readonly mode: DisableMode;
  readonly archive: boolean;
  readonly replacementSkillId: string | null;
  /**
   * 该 skill **此刻**在库里的状态（#459 修复）。
   *
   * ⚠ 这个字段在 2026-08-05 之前不存在，本函数把状态机的 `from` **硬编码成 `已启用`**。
   *   后果不是「错误码不准」：拿它去停用一个 `草稿`，状态机会认为这是合法的
   *   `已启用 → 已停用`，于是任何接在后面的 repository 都会**持久化一次非法状态迁移**
   *   （库里凭空多出一个从未过门禁、却已经历过「停用」的 skill）。
   *   状态机的 `from` 只能来自库（`SkillContractReadPort.statusOf`），不能来自调用方的假设。
   */
  readonly currentStatus: SkillLifecycleStatus;
}

type AdvanceFailure = Extract<AdvanceSkillStatusResult, { readonly ok: false }>;

export type DisableSkillResult =
  | { readonly ok: true; readonly status: "已停用"; readonly archived: boolean }
  | { readonly ok: false; readonly code: "REFERENCES_NOT_ENUMERATED" | AdvanceFailure["code"] };

export async function disableSkill(
  input: DisableSkillInput,
  deps: { readonly snapshots: ReferenceSnapshotStorePort; readonly audit: SecurityAuditPort },
): Promise<DisableSkillResult> {
  const latest = await deps.snapshots.loadLatest(input.skillId);
  if (latest === null || !isReferenceSnapshotFresh(input.referenceSnapshotId, latest)) {
    return { ok: false, code: "REFERENCES_NOT_ENUMERATED" };
  }

  const transition = await advanceSkillStatus(
    {
      skillId: input.skillId,
      principalId: input.principalId,
      from: input.currentStatus,
      to: "已停用",
      // 停用不是门禁事件：这条边（已启用 → 已停用）本就允许，不需要门禁状态。
      gates: { scan: null, methodologyReview: null, acknowledgedRiskItemIds: [] },
    },
    { audit: deps.audit },
  );

  if (!transition.ok) return { ok: false, code: transition.code };
  // `archived` 原样透传调用方的 `archive`：O-11 把「已归档」定成「已停用」的终态
  // **子类**而非独立状态，子类是否即时显式标记由调用方决定，这里不代它拍板。
  return { ok: true, status: "已停用", archived: input.archive };
}
