/**
 * 第三步：验证回填的领域规则。纯函数，同 `state-machine.ts`。
 *
 * ## 这一步的产出是「改什么」，不是「做得怎么样」
 *
 * 需求文档第三步要的不是一份成绩单。回填完一堆"部分兑现"而没有下文，
 * 复盘就白做了。真正的产出是**根因分类**：
 *
 * - **框架性**：判断逻辑本身错了 ⇒ 要改判断逻辑模板（`logicVersion + 1`），
 *   下一次研判会用新逻辑。
 * - **执行性**：逻辑没问题，这次没做到位 ⇒ 只改这次的流程执行，逻辑不动。
 *
 * 两者对应完全不同的动作。混成一句"没做好"，就什么也改不了——
 * 所以这里把「未兑现却不给根因」定成**硬性拒绝**，而不是一个可选字段。
 * 可选的字段在赶时间的那天一定是空的，而赶时间的那天恰恰最需要它。
 */
import { researchWorkflow as C } from "@repo/contracts";

export interface PredictionSnapshot {
  readonly verdict: C.PredictionVerdictName | null;
  readonly rootCause: C.RootCauseName | null;
}

export type FillDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: C.ResearchRefusalName };

/**
 * 能不能这样回填一条预测。
 *
 * `matched` 时根因可空——兑现了就没有"根因"可言，硬要求填一个只会得到
 * 一堆"无"。`partial` 与 `missed` 必须给：部分兑现同样意味着有东西没对上。
 */
export function decideFill(
  verdict: C.PredictionVerdictName,
  rootCause: C.RootCauseName | null,
): FillDecision {
  if (verdict !== "matched" && rootCause === null) {
    return { ok: false, refusal: "ROOT_CAUSE_REQUIRED" };
  }
  return { ok: true };
}

/**
 * 这一轮验证是否已经可以结束（进入门③「调整方案是否采纳」）。
 *
 * 判据是**每一条都回填了**，不是"填了大部分"。留一条没填就进方案审核，
 * 那条恰好可能是最难看的那条——而人天然会把最难填的留到最后。
 */
export function allPredictionsFilled(predictions: readonly PredictionSnapshot[]): boolean {
  return predictions.length > 0 && predictions.every((p) => p.verdict !== null);
}

export interface VerificationSummary {
  readonly total: number;
  readonly matched: number;
  readonly partial: number;
  readonly missed: number;
  /** 框架性根因的条数——它 > 0 意味着**判断逻辑该改**，不只是这次没做好。 */
  readonly framework: number;
  readonly execution: number;
}

/**
 * 比对表的汇总。
 *
 * 单独把 `framework` 拎出来，是因为它是整个第三步唯一会改变**下一次**研判的信号：
 * 执行性问题改的是这一次，框架性问题改的是以后每一次。
 */
export function summarize(predictions: readonly PredictionSnapshot[]): VerificationSummary {
  const count = (fn: (p: PredictionSnapshot) => boolean) => predictions.filter(fn).length;
  return {
    total: predictions.length,
    matched: count((p) => p.verdict === "matched"),
    partial: count((p) => p.verdict === "partial"),
    missed: count((p) => p.verdict === "missed"),
    framework: count((p) => p.rootCause === "framework"),
    execution: count((p) => p.rootCause === "execution"),
  };
}

/**
 * 门③通过后，判断逻辑版本该不该 +1。
 *
 * 只有存在框架性根因时才 +1。执行性问题改的是这一次的执行，逻辑模板一个字没变——
 * 此时把 `logicVersion` 加一，会让血缘里出现一个**内容与上一版完全相同的新版本**，
 * 三个月后追溯"这个结论按哪版逻辑算的"就会指向一个假的分水岭。
 */
export function shouldBumpLogicVersion(summary: VerificationSummary): boolean {
  return summary.framework > 0;
}
