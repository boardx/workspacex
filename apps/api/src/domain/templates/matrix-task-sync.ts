/**
 * F27 —— 矩阵格 → 待办同步的纯领域逻辑（`uc-2-2` R10 / 契约 `syncMatrixToTasks`，跨模块契约）。
 *
 * ## 落在这里的判断，以及为什么
 *
 * · **一格 ⇒ 恰一条待办**（D-10 的口径选择，登记在此，非本文件裁决 D-10 本身）：
 *   `workflow-orchestration.ts` 的 `computeSwitchTemplateImpact` 已经按「非空格 = 一条
 *   待办」计过一次「受影响待办数」，本文件延续同一口径——两处若各自选一种计法，
 *   3×3 = 9 这类断言在两处会得出不同答案，这正是 T11 提醒的分歧点。issue #323 的
 *   `user_visible_behavior` 逐字要求「3 环节×3 角色=9 格断言任务出现恰好 9 条待办」，
 *   ⇒ 本文件把 D-10 的悬而未决在**这一功能范围内**解成「一对一」，供 F27 落地；
 *   D-10 本身（该口径是否对全仓适用）仍待人类裁决，不是本文件能替全仓下的结论。
 * · **空文案格 = 没有对应待办**：格子存在但 `content` 是空白字符串，视同「未填」，
 *   与「格子已被删除」同一处置——两者都不该在任务列表里留下一条卡。
 * · **执行者（`executorAgentId`）来自 `skillIds`**：F26 的矩阵格没有 F63/F64 那样的
 *   `agent-output` 绑定槽，`skillIds` 是这一格唯一记录了「挂了哪个 agent 能力」的字段。
 *   这里取 `skillIds[0]`（有多个时，「记执行者」只需要证明「这格有 agent 参与」，
 *   不需要选出哪一个是「主执行者」——多 skill 场景的排序未裁决，留给未来需要时再补）。
 *   这是**本文件做的结构判断**，不是对「一格能否绑多个 agent 执行者」的裁决；已在
 *   F27 的 PR/issue 收尾评论里报告，供人类复核。
 * · **负责人恒为人**（D-39）：`assigneePrincipalId` 只来自角色归属查询（谁是这一格
 *   环节 × 角色对应的人），与 `executorAgentId` 的来源（`skillIds`）结构性不相交——
 *   同 `skill/orchestration.ts` `executorAgentIdFor` 头注的同一条纪律，糊不到一起去。
 */
import type { MatrixCellLike } from "./workflow-orchestration";

/** 判定一个格是否「有内容」——空白视同未填，见文件头。 */
export function cellHasContent(cell: Pick<MatrixCellLike, "content">): boolean {
  return cell.content.trim().length > 0;
}

/** 这格若有 agent 参与，返回记「执行者」的 agentId；见文件头「执行者来自 skillIds」一节。 */
export function executorSkillIdFor(cell: Pick<MatrixCellLike, "skillIds">): string | null {
  return cell.skillIds.length > 0 ? cell.skillIds[0]! : null;
}

export interface CellSyncPlanItem {
  readonly cellId: string;
  readonly agendaSegmentId: string;
  readonly roleKey: string;
  readonly content: string;
  readonly executorAgentId: string | null;
}

export interface MatrixTaskSyncPlan {
  /** 需要新建/更新对应待办的格（存在且非空）。 */
  readonly toUpsert: readonly CellSyncPlanItem[];
  /** 需要清掉对应待办的 cellId（被请求同步但已不存在，或已被清空）——不留孤儿卡。 */
  readonly toRemove: readonly string[];
}

/**
 * 纯函数：给定当前矩阵与本次请求同步的 cellId 集合，算出该建/该改/该删哪些格。
 *
 * ⚠ 不在这里调用任何端口——上层（`sync-matrix-to-tasks.ts`）负责把 `toUpsert` 逐条
 *   解析出负责人、调发布端口；`toRemove` 逐条调移除端口。移除端口本身要求幂等
 *   （对没有对应待办的 cellId 调用等同 no-op），本函数因此不需要先查「有没有待办」
 *   才能算出该不该删——这与 `advance-agenda-segment.ts` 里「仓储直接尝试，不先查后写」
 *   是同一条纪律。
 */
export function planMatrixTaskSync(
  matrix: readonly MatrixCellLike[],
  requestedCellIds: readonly string[],
): MatrixTaskSyncPlan {
  const byId = new Map(matrix.map((c) => [c.cellId, c] as const));
  const toUpsert: CellSyncPlanItem[] = [];
  const toRemove: string[] = [];

  for (const cellId of requestedCellIds) {
    const cell = byId.get(cellId);
    if (cell === undefined || !cellHasContent(cell)) {
      toRemove.push(cellId);
      continue;
    }
    toUpsert.push({
      cellId: cell.cellId,
      agendaSegmentId: cell.agendaSegmentId,
      roleKey: cell.roleKey,
      content: cell.content,
      executorAgentId: executorSkillIdFor(cell),
    });
  }

  return { toUpsert, toRemove };
}
