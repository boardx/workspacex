/**
 * UC-P7 `advanceAgendaSegment` —— 四种去向（推进 / 提前结束 / 跳过 / 合并）分别落到哪个
 * 终态、要不要带 `mergedInto`。**纯函数，不碰仓储、不碰权限**——四种去向是一张闭集表，
 * 闭集判据摆在这里比散落在 use case 的 if/else 里更容易被机械核对。
 *
 * ## 为什么四个动作只映射到两个终态
 *
 * `AgendaSegmentState` 是四态 `pending/active/closed/skipped`（I-P43），而
 * `AgendaSegmentAdvanceAction` 是四个动作词（Q-2② B）。二者不是一一对应：
 *   · `advance`（正常推进）与 `closeEarly`（提前结束）**在数据库层是同一个终态** `closed`——
 *     两者的区别是**审计里记的动作词不同**（正常完成 vs 提前叫停），不是状态机的另一档。
 *     这不是遗漏：`AgendaSegmentState` 没有第五个值，域里也没有出处要求区分它们的存储形状。
 *   · `skip`（跳过）落 `skipped`——四态里专门留给它的终态。
 *   · `merge`（合并）落 `closed` 并**必须**带 `mergedInto`——「并入」在语义上是「这个环节的
 *     内容归了别处，正常结束」，不是「被跳过」；`skipped` 也允许带 `mergedInto`（I-P43），
 *     但本域没有任何裁决要求 `merge` 落 `skipped`，落 `closed` 是本文件的判断，
 *     若签核人认为「合并」应可作用于 `skipped` 环节，这里是要改的唯一一处。
 */
import type { z } from "zod";
import { project } from "@repo/contracts";

export type AgendaSegmentAdvanceAction = z.infer<typeof project.AgendaSegmentAdvanceAction>;
export type AgendaSegmentState = z.infer<typeof project.AgendaSegmentState>;

/** 终结态：只有 `closed` / `skipped` 会从本操作产生（I-P43：非终态上 `mergedInto` 必须为空）。 */
export type AgendaSegmentTerminalState = Extract<AgendaSegmentState, "closed" | "skipped">;

/** 四个动作词 → 落地终态，闭集穷举，不许有第五个分支。 */
export const ADVANCE_ACTION_TARGET_STATE: Readonly<
  Record<AgendaSegmentAdvanceAction, AgendaSegmentTerminalState>
> = {
  advance: "closed",
  closeEarly: "closed",
  skip: "skipped",
  merge: "closed",
} as const;

export function targetStateFor(action: AgendaSegmentAdvanceAction): AgendaSegmentTerminalState {
  return ADVANCE_ACTION_TARGET_STATE[action];
}

/** 只有 `merge` 要求非空 `mergeIntoSegmentId`（契约 `advanceAgendaSegment.in` 注释逐字）。 */
export function requiresMergeTarget(action: AgendaSegmentAdvanceAction): boolean {
  return action === "merge";
}

/** `closed` / `skipped` 是终态：对它们再次调用任何一个动作都应得到 `SEGMENT_TERMINAL`（I-P43）。 */
export function isTerminalState(state: AgendaSegmentState): boolean {
  return state === "closed" || state === "skipped";
}
