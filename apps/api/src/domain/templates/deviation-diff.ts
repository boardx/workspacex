/**
 * 偏离 diff（F29 / `uc-2-3` R3 步骤 1 / 契约 `templates.computeDeviations`）。
 *
 * ## 唯一的性质：按配置项定义表逐项遍历，不硬编码项数
 *
 * `uc-2-3` 头部裁决（D-03 术语三分）逐字：「本用例的偏离 diff 应**按配置项定义表遍历**，
 * 不得硬编码 16 项」——同 `design-facet-table.ts` 头注的同一条纪律（I-5）。这里的 diff
 * 因此不读 `Object.keys(content)`（那会让「表里没有的键」也能产生一条偏离，表就不再是
 * 唯一事实源），而是遍历 `DESIGN_FACET_DEFINITIONS`（或调用方传入的表），逐行取
 * 蓝本快照值与项目当前值比较。
 *
 * ⚠ 「议程环节的增删改归到第 2 项『流程 Agenda』名下」（R3 步骤 1）在这里**不需要特殊代码**：
 * `flow-agenda` 本来就是表里普通的一行，议程环节的值只要被写进
 * `content["flow-agenda"]`，就自动落进同一条偏离——本函数不知道、也不需要知道
 * 「这一项底下是议程环节」这件事。
 *
 * ## 未改动项不出现（V2），空清单是真实空态（A3）
 *
 * 只在 `before !== after` 时才 push 一条；调用方看到空数组即代表「这场完全照蓝本跑」，
 * 不需要再判断一次「是不是没数据」——空数组本身就是答案。
 */
import { DESIGN_FACET_DEFINITIONS, orderedDesignFacets, type DesignFacetRow } from "./design-facet-table";

/** 一条偏离：`蓝本原值 → 本场实际值`（R3 步骤 1 逐字要求的呈现形状）。 */
export interface Deviation {
  readonly designFacetKey: string;
  readonly beforeValue: string;
  readonly afterValue: string;
}

/**
 * 把任意配置项的值规整成可比较、可展示的字符串。
 *
 * ⚠ 缺失键（`undefined`/`null`）归一到 `""`，不是字面量 `"undefined"`——否则「从未填过
 * 这一项」与「填了字符串 undefined」在 diff 里会变成同一件事的两种不同表现。
 * 非字符串值（对象/数组/布尔/数字）用 `JSON.stringify`：这里只关心「值变没变」，
 * 不关心它的形状（`blueprint-version.ts` 头注同一立场：把 content 当不透明快照）。
 */
export function stringifyFacetValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * 算偏离。`baseContent` = 项目绑定的蓝本版本快照，`currentContent` = 项目当前值。
 * 两者都是**不透明** `Record<designFacetKey, unknown>`——本函数不解释值的内部形状。
 */
export function computeDeviations(
  baseContent: Readonly<Record<string, unknown>>,
  currentContent: Readonly<Record<string, unknown>>,
  table: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS,
): Deviation[] {
  const deviations: Deviation[] = [];
  for (const row of orderedDesignFacets(table)) {
    const beforeValue = stringifyFacetValue(baseContent[row.designFacetKey]);
    const afterValue = stringifyFacetValue(currentContent[row.designFacetKey]);
    if (beforeValue !== afterValue) {
      deviations.push({ designFacetKey: row.designFacetKey, beforeValue, afterValue });
    }
  }
  return deviations;
}
