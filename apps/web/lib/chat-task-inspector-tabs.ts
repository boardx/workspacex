/**
 * issue #2068（TW-P0-4）—— 右栏动态 Inspector 的**页签选择规则**，抽成纯函数。
 *
 * ## 为什么不写在组件里
 *
 * 「按任务阶段自动切换」是这条验收里唯一有分支的逻辑（三个信号 + 一个"用户手点过
 * 之后要不要被覆盖"的优先级问题）。埋在 `useEffect` 里只能靠真栈 e2e 反证，一轮
 * 十几分钟；抽成纯函数就能被 vitest 逐条钉死，真栈 e2e 只负责证明"接线是通的"。
 *
 * ## 规则：只有**信号发生变化**才自动切，不是"当前状态是什么就切到哪"
 *
 * 这两者不是一回事，差别正是用户的控制权：如果按"当前状态"切，用户在运行中手点
 * 「材料」，下一次重渲染又被拽回「进度」——那不是自动切换，那是锁死。所以本函数
 * 比较的是 `prev` 与 `next` 两次快照之间的**跃迁**（材料变多 / 产物变多 /
 * 运行从停到跑），没有跃迁就原样返回 `current`，用户手点的选择保留。
 *
 * 同一 tick 内多个信号同时跃迁时的优先级（高 → 低）：**产物 > 材料 > 运行**。
 * 依据是人类原话的时间顺序——"上传材料时开材料，运行时开进度，出结果时开产物"——
 * 出结果是这条链的终点，它到达时必然仍在/刚离开运行态，若让运行态压过它，用户
 * 永远看不到产物自动弹出来。
 */

export type InspectorTab = "progress" | "materials" | "artifacts" | "roster" | "run-details";

export const INSPECTOR_TABS: readonly InspectorTab[] = [
  "progress",
  "materials",
  "artifacts",
  "roster",
  "run-details",
];

/** 决定页签的三个信号。全部读真实数据，没有一维是本地伪造的。 */
export interface InspectorSignals {
  /** 本线程材料条数（已上传附件 + 已落库材料）。 */
  readonly materialsCount: number;
  /** 本线程产物条数。 */
  readonly artifactsCount: number;
  /** 是否有一轮 run 正在跑（`agent.isRunning`，不是定时器）。 */
  readonly isRunning: boolean;
}

/**
 * 上一次信号 → 这一次信号的跃迁决定下一个页签。`prev` 为 null（首帧）时不自动切，
 * 返回 `current`：刚打开页面就把用户拽到某个页签，与"自动切换"是两回事。
 */
export function nextInspectorTab(
  prev: InspectorSignals | null,
  next: InspectorSignals,
  current: InspectorTab,
): InspectorTab {
  if (prev === null) return current;
  if (next.artifactsCount > prev.artifactsCount) return "artifacts";
  if (next.materialsCount > prev.materialsCount) return "materials";
  if (next.isRunning && !prev.isRunning) return "progress";
  return current;
}

/**
 * 折叠判据（验收卡 TW-P0-4③：无内容时折叠，不常驻占屏）。
 *
 * ⚠ 「无内容」按**各页签各自有没有真东西可看**判，不是按"有没有选中线程"判：
 * 一条刚建好、什么都没发生的线程，其余页签全是空态，这时右栏占六分之一屏就是
 * 人类批评的那件事。计划存在 = 进度页有内容；有 run 在跑 = 进度/运行详情有内容。
 *
 * `hasRoster`（2026-08-29 新增，CK-P7 编制面板从左栏搬进「编制」页签之后）与其余
 * 四个信号同一套判据——编制非空同样算"有真东西可看"，不折叠。空编制不撑开：
 * 折叠态下五个页签本身仍以图标形式常驻可点（见 `chat-task-inspector.tsx` 文件头
 * 注），编制入口并不会因为折叠而不可达。默认 `false`，既有的 3 参数调用（本文件
 * 之外的测试）行为不变，不是悄悄改了旧调用点的语义。
 */
export function isInspectorCollapsed(
  signals: InspectorSignals,
  hasPlan: boolean,
  hasRunDetails: boolean,
  hasRoster = false,
): boolean {
  return (
    signals.materialsCount === 0 &&
    signals.artifactsCount === 0 &&
    !signals.isRunning &&
    !hasPlan &&
    !hasRunDetails &&
    !hasRoster
  );
}
