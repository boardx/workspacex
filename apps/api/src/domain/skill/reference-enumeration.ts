/**
 * **引用枚举三类 + 硬删永久拒绝**（F66；UC-3.4 R3 分支 B 步骤 6-8、R6 AC3/AC4、R7）。
 *
 * 两件事写在同一个文件里，是因为它们共享同一个数据形状（`ReferenceSnapshot`）
 * 且第二件事的判据必须读第一件事的结果——`listReferences` 契约注释逐字
 * 「无清单不得停用」，硬删的判据比停用更严：**只要清单存在，硬删就恒被拒绝**
 * （契约 `hardDeleteSkill.out = z.never()`：没有成功形状这件事本身要写进契约，
 * 详见 `packages/contracts/src/skills.ts` 的 `KNOWN_CONTRACT_GAPS.S1`——
 * 「引用存在才拒绝」与「无条件拒绝」之间的张力已在契约里登记，本文件按契约落，
 * 不在这里另开一份判断）。
 */
import type { SkillOriginTag } from "./source-tag";

/**
 * 停用前置清单（AC4）：**三类**，且清单为空要能与「没查」区分开。
 *
 * ⚠ 三个数组各自可空，但 `asyncTaskId` 非 null 时上面三项是**部分结果**——
 *   这是契约注释逐字的口径：规模大时转异步，调用方不能把「还没查完」
 *   误读成「真的没有引用」。
 */
export interface ReferenceSnapshot {
  readonly referenceSnapshotId: string;
  readonly skillId: string;
  readonly inFlightProjects: readonly string[];
  readonly templateBindings: readonly string[];
  readonly agentMounts: readonly string[];
  readonly asyncTaskId: string | null;
}

/** 三类合计是否存在任何引用。⚠ 只在 `asyncTaskId === null`（已查全）时才有意义地回答「没有」。 */
export function hasAnyReference(snapshot: ReferenceSnapshot): boolean {
  return (
    snapshot.inFlightProjects.length > 0 ||
    snapshot.templateBindings.length > 0 ||
    snapshot.agentMounts.length > 0
  );
}

/**
 * 「真空态」＝ 三类都查完了（不是异步截断的部分结果）且三类都是零条。
 *
 * ⚠ 与 `hasAnyReference() === false` 分开写成一个函数，是因为调用方（界面层）
 *   要能把「查完了、真的没有」渲染成 A1 要求的**真实空态**，
 *   与「还在异步查、暂时看起来是空的」渲染成两种不同的东西——
 *   合并成一个布尔就是把这两件事糊成一句话。
 */
export function isConfirmedEmpty(snapshot: ReferenceSnapshot): boolean {
  return snapshot.asyncTaskId === null && !hasAnyReference(snapshot);
}

/**
 * 停用前置校验（R7「无清单不得停用」）：`disableSkill` 收到的 `referenceSnapshotId`
 * 必须对应**这一次**调用产出的清单，而不是一个陈旧的 id——防止「拿一份很久以前、
 * 早已过期的空清单去停用一个此刻其实一堆项目正在用的 skill」。
 */
export function isReferenceSnapshotFresh(
  provided: string,
  latest: ReferenceSnapshot,
): boolean {
  return provided === latest.referenceSnapshotId;
}

/* ─────────────────────── 硬删：永久拒绝 ─────────────────────── */

export type HardDeleteRejectCode = "HARD_DELETE_FORBIDDEN" | "BUILTIN_NOT_DELETABLE";

export interface HardDeleteVerdict {
  /** ⚠ 恒 `true`——这是「只有失败出口的用例」在类型层面的样子，见文件头。 */
  readonly rejected: true;
  readonly code: HardDeleteRejectCode;
  readonly reason: string;
  /** 拒绝时**返回引用清单**（R6 AC3 逐字），即便三类恰好都是零条。 */
  readonly references: ReferenceSnapshot;
}

/**
 * 硬删求值。**没有返回「允许」的分支**——函数签名上就没有那个返回类型，
 * 不是运行时判断出来的结果。
 *
 * · `source = CC`（内置）⇒ `BUILTIN_NOT_DELETABLE`，与是否有引用无关（R7「内置只能停用/隐藏」）。
 * · 其余一律 `HARD_DELETE_FORBIDDEN`——`references` 仍然带出去，即使为零条，
 *   因为「此刻没有引用」不等于「删除是安全的」：契约把这个操作整体建模成
 *   「提供但恒拒」（S1），真正的删除走 17-gov 的合规删除流程（本用例明确不包含）。
 */
export function evaluateHardDelete(input: {
  readonly source: SkillOriginTag;
  readonly references: ReferenceSnapshot;
}): HardDeleteVerdict {
  if (input.source === "CC") {
    return {
      rejected: true,
      code: "BUILTIN_NOT_DELETABLE",
      reason: "来源标记为 CC 的内置 skill 不可删除，只能停用/隐藏（参照画布模板「内置不可删」）",
      references: input.references,
    };
  }
  return {
    rejected: true,
    code: "HARD_DELETE_FORBIDDEN",
    reason:
      "硬删除永久拒绝：历史引用（含已交付项目的产出溯源）必须永远可解析到方法来源；" +
      "删除请求一律走合规删除流程（17-gov / UC-17.2），不在本用例范围",
    references: input.references,
  };
}
