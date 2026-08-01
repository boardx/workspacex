/**
 * 项目筹备页外壳 —— 四子标签 + 计数（F24 / `uc-2-2` R7-R8 / 契约 `templates.getProjectPrep`）。
 *
 * 纯函数：没有时钟、没有 I/O、没有存储。给定四类各自的**真实**计数，算出四子标签的
 * `label`（人看的、带数字的中文短句）与 `count`（机器看的、供 V6「计数与实际写入数据一致」
 * 断言的裸数字）。仓储怎么数出这四个数字不是本文件的事——那是 F25-F28 各自领域模型的活；
 * 本文件只保证「同一份数字」既出现在 label 里也出现在 count 里，不会有第三份口径。
 *
 * ## 为什么 `label` 与 `count` 是两个字段，而不是只留 `label` 让前端自己解析
 *
 * 契约 `getProjectPrep.out.tabs[].count` 就是为了让 V6 能直接断言一个数字，不必在测试里
 * 用正则从「会前任务 7/12」这样的中文短句里抠数字出来——那种「靠格式化字符串反推数据」
 * 的测试本身就是脆的（改一个字都要跟着改断言）。
 *
 * ## `pre-tasks` 的 `count` 为什么是 `total` 不是 `done`
 *
 * label 是「会前任务 7/12」——两个数字都在里面。`count` 只能留一个，取哪个要有判据：
 * 「计数与实际写入数据一致」（V6）说的是**条目数**，会前任务这一类里「有多少条任务」
 * 是 `total`，「做完了几条」是任务自身的完成态，不是这一类「写了多少条」的答案。
 * 因此与其余三类保持同一语义：`count` 恒等于「这一类实际写入了多少条」。
 *
 * ## `topic-grouping` 的 `label` 为什么不带数字
 *
 * 原型逐字：四个标签只有后三个带数字后缀（`议程 7 环节` / `材料准备 9 份` /
 * `会前任务 7/12`），`定题与分组` 没有——因为它不是「条目计数」，是「有没有定题+分完组」
 * 这件事本身。`count` 仍然给出真实的分组数（供未来 UI 需要时用，不强行编一个和 label
 * 不对应的数字），但**不**拼进 label，免得凭空发明一个原型没有的「定题与分组 4」字样。
 */

export type ProjectPrepTabKey = "topic-grouping" | "agenda" | "materials" | "pre-tasks";

/** 四类各自的真实条目数——由仓储（未来的 F25-F28 领域模型）产出，本文件只消费。 */
export interface ProjectPrepCounts {
  readonly groupCount: number;
  readonly agendaSegmentCount: number;
  readonly materialsCount: number;
  readonly preTasksDone: number;
  readonly preTasksTotal: number;
}

export interface ProjectPrepTab {
  readonly key: ProjectPrepTabKey;
  readonly label: string;
  readonly count: number;
}

/** 恒 4 个，顺序固定，即使某一类今天全是 0（V15 空态）也要出现——同 F23 六类的理由。 */
export const PROJECT_PREP_TAB_KEYS: readonly ProjectPrepTabKey[] = [
  "topic-grouping",
  "agenda",
  "materials",
  "pre-tasks",
];

export function planProjectPrepTabs(counts: ProjectPrepCounts): readonly ProjectPrepTab[] {
  return [
    { key: "topic-grouping", label: "定题与分组", count: counts.groupCount },
    { key: "agenda", label: `议程 ${counts.agendaSegmentCount} 环节`, count: counts.agendaSegmentCount },
    { key: "materials", label: `材料准备 ${counts.materialsCount} 份`, count: counts.materialsCount },
    {
      key: "pre-tasks",
      label: `会前任务 ${counts.preTasksDone}/${counts.preTasksTotal}`,
      count: counts.preTasksTotal,
    },
  ];
}

/** V15：空态是真实空态，不是把 counts 换成一组示例数字——本函数对全 0 输入不做特殊分支。 */
export const EMPTY_PROJECT_PREP_COUNTS: ProjectPrepCounts = {
  groupCount: 0,
  agendaSegmentCount: 0,
  materialsCount: 0,
  preTasksDone: 0,
  preTasksTotal: 0,
};
