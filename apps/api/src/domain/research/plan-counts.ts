/**
 * F146 —— 研究计划三计数：目标缺失渲染 `—` 而不是 `0`（`research` 束 domain.md N-8，
 * `uc-24-3` R3.D / R12.3，`packages/contracts/src/research.ts` `getResearchPlan` 注释逐字）。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 *   这里收进的是「三计数从原始数据推导出来」这一处**唯一的计算**，调用点
 *   （未来的 application 层用例）不得各自再算一遍、也不得把 `undefined` 悄悄转成 `0`。
 *
 * ## 这个文件必须立住的不变量
 *
 * 1. **N-8：`null` 与 `0` 必须可区分。** `evidenceTarget` 缺失时是 `null`，
 *    界面据此渲染 `—`；返回 `0` 会让人读成「目标 0，已超额完成」——这是
 *    `getResearchPlan` 注释里明说「最容易做错」的一处。
 * 2. **Q-8 未裁（研究问题一层还是两层模型）落在 `questionCount` 上**：
 *    两层模型下它是子实体计数（`questions` 数组存在，长度可以是 0）；
 *    一层模型下它**根本没有对象**（`questions` 是 `null`，不是空数组）。
 *    两种「没有」的含义不同，因此入参本身区分 `null`（无该子实体）与 `[]`（有但为空）。
 * 3. **`evidenceTarget` 是原样透传，不是重新计算的。** 计数是派生值不假，但目标
 *    是使用方自己设的一个数（或没设），这里只做「透传 + 拒绝把 `undefined` 强转 `0`」，
 *    不发明推导规则。
 * 4. **`candidateInsightCount` 与 `questionCount` 同族**：调用方传 `null` 表示
 *    该研究没有候选洞察这个概念/ 子系统未启用；传 `[]` 表示有、但目前是 0 条。
 */

/** 计划三计数的输入：`null` = 该子实体/子系统在本研究里不存在；数组 = 存在，逐条计数。 */
export interface PlanCountsInput {
  readonly questions: readonly unknown[] | null;
  readonly evidence: readonly unknown[];
  /** ⚠ 使用方设置的目标值本身。`null` = 未设目标（N-8 的主战场），不是 0。 */
  readonly evidenceTarget: number | null;
  readonly candidateInsights: readonly unknown[] | null;
}

export interface PlanCounts {
  readonly questionCount: number | null;
  readonly evidenceCount: number;
  readonly evidenceTarget: number | null;
  readonly candidateInsightCount: number | null;
}

/**
 * 从原始数据推导 `getResearchPlan` 的三计数 + 目标。
 *
 * ⚠ **`evidenceCount` 恒等于 `evidence.length`，不是 nullable**——契约允许它 nullable
 *   只是为了跟另外两个字段同形状，但 `evidence` 这个数组本身在这层永远存在
 *   （证据表哪怕零行也是一张「有 0 行的表」，不是「没有证据这个概念」），
 *   所以这里给出确定的 `number`，由调用方在契约边界决定是否再包一层 `nullable`。
 */
export function derivePlanCounts(input: PlanCountsInput): PlanCounts {
  return {
    questionCount: input.questions === null ? null : input.questions.length,
    evidenceCount: input.evidence.length,
    // ⚠ 透传，不重算、不做 `?? 0`。undefined 也不被允许在类型层出现，
    //   但防御性地把它当成"没设"而不是"0"，理由与 null 完全一致。
    evidenceTarget: input.evidenceTarget === undefined ? null : input.evidenceTarget,
    candidateInsightCount: input.candidateInsights === null ? null : input.candidateInsights.length,
  };
}

/**
 * 界面侧的渲染判据（`—` vs 数字）。**不是**又一份 `!value` 判断——
 * `0` 是合法值（该研究此刻真的有 0 条），必须渲染 `0`，不能被判成缺失。
 */
export function isCountMissing(value: number | null | undefined): boolean {
  return value === null || value === undefined;
}
