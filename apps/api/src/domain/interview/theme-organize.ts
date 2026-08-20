/**
 * F04 —— 主题整理三动作（合并/拆分/调权）的纯计算部分（uc-6-5 R3 step6，R12 V4/V12）。
 *
 * ⚠ 与 `domain/interview/evidence-matrix.ts` 的分工：那个文件是"给定一个格子的原始事实，
 *   该显示什么五取值"（`computeCellStrength`）与"合并前后反例集合是否有丢失"
 *   （`guardCounterexamplePreservation`）——两者都是本 feature notes 明确要求"复用、
 *   不重写"的既有守护逻辑。本文件只补上这两个函数之间缺的一环：**把一组引述事实聚合成
 *   `guardCounterexamplePreservation` 要的"格子"形状**，供 `mergeThemes`/`splitThemes`/
 *   `adjustEvidenceWeight` 三个 application 层算子共用，不各自重写一遍聚合逻辑。
 *
 * ⚠ 本文件刻意没有的东西：**"强/弱"的真实裁定算法**——那是 F02（证据矩阵读路径）的
 *   职责，本 feature 的 verification 完全不依赖强弱判据本身，只依赖"反例/附和的覆盖
 *   优先级不能被本文件的聚合破坏"。`rawStrength` 用一个确定性占位（≥2 条独立引述记
 *   `strong`，否则 `weak`），如实标注是占位，不冒充已裁定的业务规则。
 */
import {
  computeCellStrength,
  guardCounterexamplePreservation,
} from "./evidence-matrix";
import type {
  CounterexampleCellRef,
  CounterexampleGuardResult,
  EvidenceStrengthT,
} from "./evidence-matrix";

export { guardCounterexamplePreservation };
export type { CounterexampleGuardResult };

/** 一条引述在"该不该计入某个矩阵格子"这件事上的最小事实。 */
export interface ThemeQuoteFact {
  readonly quoteId: string;
  /** `null` = 该引述没有已解析出的说话人，无法归入任何格子（矩阵按受访者分行）。 */
  readonly subjectId: string | null;
  readonly isCounterexample: boolean;
  readonly isAppeasement: boolean;
  /**
   * ⚠ `weight <= 0` 的引述视为**已不再作为证据存在**——`adjustEvidenceWeight` 调到 0
   *   等价于把这条引述从矩阵里抹掉，这正是它可能触发 `COUNTEREXAMPLE_WOULD_VANISH`
   *   的原因（migration 文件头）。
   */
  readonly weight: number;
}

export interface ThemeSubjectCell extends CounterexampleCellRef {
  readonly strength: EvidenceStrengthT;
}

/**
 * buildThemeSubjectCells —— 给定（某个主题下）一批引述事实，按受访者聚合成矩阵格子。
 *
 * ⚠ 同一受访者的多条引述聚合成同一个格子；`computeCellStrength` 的覆盖优先级
 *   （反例 > 附和 > 未提及 > 原始强/弱）由 `evidence-matrix.ts` 单点裁定，本函数只负责
 *   "把哪些引述算作同一个受访者在这个主题下的事实"这一步，不重复优先级判断。
 */
export function buildThemeSubjectCells(
  themeId: string,
  quotes: readonly ThemeQuoteFact[],
): ThemeSubjectCell[] {
  const bySubject = new Map<string, ThemeQuoteFact[]>();
  for (const q of quotes) {
    if (q.subjectId === null || q.weight <= 0) continue;
    const list = bySubject.get(q.subjectId) ?? [];
    list.push(q);
    bySubject.set(q.subjectId, list);
  }

  const cells: ThemeSubjectCell[] = [];
  for (const [subjectId, qs] of bySubject) {
    const strength = computeCellStrength({
      hasQuotes: qs.length > 0,
      isCounterexample: qs.some((q) => q.isCounterexample),
      isAppeasement: qs.some((q) => q.isAppeasement),
      // 占位裁定，见文件头——本 feature 不依赖它的具体阈值，只依赖两两不同。
      rawStrength: qs.length >= 2 ? "strong" : "weak",
    });
    cells.push({ themeId, subjectId, strength });
  }
  return cells;
}
