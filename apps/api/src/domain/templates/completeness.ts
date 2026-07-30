/**
 * 完成度派生（F17 / I-5，口径 O-32 ④「完成度 = 已完成项 / 已定义项」）。
 *
 * 纯函数：没有时钟、没有 I/O、没有存储。输入是「哪些槽位已完成」，
 * 输出是 `{ done, denominator }`——**两者都由这里算**（契约 `Completeness` 的
 * 逐字注释：「`done / denominator`，两者都由服务端给」）。
 *
 * ## 为什么 `done` 也要过一遍表
 *
 * 直接 `completedKeys.length` 看起来更简单，而它会让**一个不存在的 key 也计入完成度**：
 * 改表删掉一项之后，历史数据里那一项的完成标记仍在，`12/14` 会显示成 `13/14`——
 * 一个永远差一点点、没人能解释的分子。所以这里对表取交集，并把落单的 key
 * 原样返回（`unknownKeys`），让它可见而不是被吞掉。
 */

import {
  DESIGN_FACET_DEFINITIONS,
  designFacetDenominator,
  isDesignFacetKey,
  type DesignFacetRow,
} from "./design-facet-table";

export interface CompletenessResult {
  /** 已完成且**仍在表中**的槽位数 */
  readonly done: number;
  /** **恒等于表的条目数**（I-5）。不是常量，不是 15，不是 16 */
  readonly denominator: number;
  /** 已完成标记里指向表中不存在的槽位的那些 key。⚠ 不计入 `done`，也不静默丢弃 */
  readonly unknownKeys: readonly string[];
}

export function deriveCompleteness(
  completedKeys: Iterable<string>,
  table: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS,
): CompletenessResult {
  const seen = new Set(completedKeys);
  const known: string[] = [];
  const unknown: string[] = [];
  for (const key of seen) (isDesignFacetKey(key, table) ? known : unknown).push(key);
  return {
    done: known.length,
    denominator: designFacetDenominator(table),
    unknownKeys: unknown,
  };
}

/** 显示串 `n/N`。⚠ 界面侧不得自己拼——分子分母都来自上面那一次派生。 */
export function formatCompleteness(result: CompletenessResult): string {
  return `${result.done}/${result.denominator}`;
}
