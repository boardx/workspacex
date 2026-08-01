/**
 * F148 —— 现场研究任务列表与冲突判定（`research` 束 domain.md N-6 / N-9，
 * `uc-24-5` R3.2–R3.6 / A1 / A2，`usecases.md` 二节 `ListLiveResearchTasks` /
 * `ListConflicts` / `ResolveConflict` 注释）。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 *   这里收进的是「现场任务过滤/计数」与「冲突判定留痕」这两处**唯一的计算**，
 *   调用点（未来的 application 层用例）不得各自再算一遍。
 *
 * ## 这个文件必须立住的不变量
 *
 * 1. **A1：`onlyConflicts` 的判据取 `conflictCount > 0`，不是状态词。**
 *    状态枚举尚未收敛（Q-10），按 `status === "待判定"` 之类的词过滤，会在
 *    Q-10 裁完、状态词改写之后整条悄悄失效——没有任何测试会红。
 * 2. **A2：冲突数为 0 时，冲突区依然存在，只是空。**
 *    `computeLiveTaskCounts` / `pendingConflictCount` 恒返回一个数（可为 0），
 *    调用方（界面）据此渲染空态而不是把整个区块摘掉。
 * 3. **N-6：三个判定动作恒为全集，不带预选/默认/倒计时字段。**
 *    `assertConflictActionsNotPreselected` 断的是**性质**——这个对象上没有
 *    `suggestedAction` / `defaultAction` / `countdownSeconds` 这类字段，
 *    不是断言 `actions.length === 3`（长度断言在删一个加一个时会全绿）。
 * 4. **N-9 / R6：判定留痕（谁 / 何时 / 选了哪一条），且不可静默清空。**
 *    `resolveConflict` 只有「从未判定 → 已判定」这一条单向变化；
 *    本文件**没有** `unresolveConflict`——契约本身也没有对应端口（Q-19 未裁，
 *    「已判定的冲突在新证据出现后是否重开」不由本域回答）。
 * 5. **一行 agent 失败不影响其余行。** `filterLiveTasks` / `computeLiveTaskCounts`
 *    对每一行独立求值，不做「一行坏、全表塌」的整体判断。
 */
import type { research } from "@repo/contracts";
import type { z } from "zod";

export type ConflictActionT = z.infer<typeof research.ConflictAction>;
export type ResearchConflictT = z.infer<typeof research.ResearchConflict>;

/** 现场一行任务（`listLiveResearchTasks.out.tasks[number]` 的镜像形状）。 */
export interface LiveTaskRow {
  readonly researchId: string;
  readonly at: string;
  readonly question: string;
  readonly proposedBy: string;
  /** ⚠ 值域未定（Q-10），本域不收敛，原样透传 */
  readonly status: string;
  readonly sourceCount: number;
  readonly conflictCount: number;
}

/**
 * **A1 的判据本身**：`onlyConflicts` 时只留 `conflictCount > 0` 的行。
 *
 * ⚠ 刻意不接受、也不查看 `status` 字段——状态词的全集与同义关系都还没裁（Q-10），
 *   按词过滤在裁决落地那天会整条失效，且没有任何断言会报警。
 */
export function filterLiveTasks(tasks: readonly LiveTaskRow[], onlyConflicts: boolean): LiveTaskRow[] {
  return onlyConflicts ? tasks.filter((t) => t.conflictCount > 0) : [...tasks];
}

export interface LiveTaskCounts {
  readonly total: number;
  readonly ready: number;
  readonly conflicts: number;
}

/**
 * 头部「n 个 · m 个已就绪」两个数 + 冲突总数，**全部派生自 `tasks` 本身**，
 * 不接受任何入参回显（`listResearch` 注释同型的「假数据穿透」形状本域也要挡）。
 *
 * ⚠ `ready` 的判据用现场侧字面量 `"已就绪"`（`RESEARCH_STATUS_PENDING.liveRow`
 *   三值之一）——这个宽松是 Q-10 的待裁标记，不是设计；Q-10 裁决落地后
 *   这里要跟着换成收敛后的枚举比较，而不是继续摆一个字符串常量。
 */
export function computeLiveTaskCounts(tasks: readonly LiveTaskRow[]): LiveTaskCounts {
  return {
    total: tasks.length,
    ready: tasks.filter((t) => t.status === "已就绪").length,
    conflicts: tasks.reduce((sum, t) => sum + t.conflictCount, 0),
  };
}

/**
 * **A2 的判据本身**：冲突待判定数——恒返回一个数（含 0），调用方据此渲染，
 * 不因为是 0 就把整个区块的存在性也一起摘掉。
 */
export function pendingConflictCount(conflicts: readonly ResearchConflictT[]): number {
  return conflicts.filter((c) => c.resolution === null).length;
}

/**
 * **N-6 的机械判据**：一个冲突对象上**不存在**任何预选/默认/倒计时字段。
 *
 * ⚠ 这是性质断言，不是形状断言的反面（`ResearchConflict` 本身用 `.strict()`
 *   已经在 zod 层面挡住多余字段；这个函数额外把「挡的是哪几个名字」显式钉出来，
 *   给测试一个不依赖 zod 内部实现的判据）。
 */
const FORBIDDEN_PRESELECTION_KEYS = ["suggestedAction", "defaultAction", "countdownSeconds", "autoResolveAt"] as const;

export function assertConflictActionsNotPreselected(conflict: ResearchConflictT): void {
  for (const key of FORBIDDEN_PRESELECTION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(conflict, key)) {
      throw new Error(`N-6 违反：ResearchConflict 上出现了预选/自动执行字段 "${key}"`);
    }
  }
}

/**
 * 三个动作是否为**全集、无序**（N-6 的另一半：不是「预选了其中一个」，
 * 而是「三个都在，且没有谁排在被高亮的位置上」——数组顺序不构成预选）。
 */
export function isFullActionSet(actions: readonly ConflictActionT[], fullSet: readonly ConflictActionT[]): boolean {
  if (actions.length !== fullSet.length) return false;
  const a = new Set(actions);
  return fullSet.every((x) => a.has(x));
}

export interface ResolveConflictInput {
  readonly action: ConflictActionT;
  readonly actorUserId: string;
  readonly resolvedAt: string;
}

/**
 * `ResolveConflict`（`usecases.md` 1.5）—— 唯一允许的变化：`resolution: null → 非空`。
 *
 * ⚠ **不做「已判定再判一次」的静默覆盖**：若 `conflict.resolution` 已非空，
 *   本函数拒绝——覆盖会让「谁在何时选了哪一条」这条留痕失去意义（第一次判定
 *   的痕迹会被第二次覆盖掉，而 R6 要求的正是这条痕迹本身）。
 *   ⚠ 是否允许在新证据出现后**重开**判定 → Q-19 未裁，本函数不表达重开，
 *   只表达「已判定的不可再次静默改写」这一条更弱、更安全的不变量。
 */
export function resolveConflict(
  conflict: ResearchConflictT,
  input: ResolveConflictInput,
): ResearchConflictT {
  if (conflict.resolution !== null) {
    throw new Error(
      `冲突 ${conflict.id} 已由 ${conflict.resolution.actorUserId} 于 ${conflict.resolution.resolvedAt} 判定为「${conflict.resolution.action}」——不允许静默覆盖（N-9/R6，重开语义 Q-19 未裁）`,
    );
  }
  return {
    ...conflict,
    resolution: {
      action: input.action,
      actorUserId: input.actorUserId,
      resolvedAt: input.resolvedAt,
    },
  };
}
