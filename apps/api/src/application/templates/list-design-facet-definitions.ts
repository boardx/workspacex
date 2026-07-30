/**
 * 用例：读配置项定义表（契约 `templates.operations.listDesignFacetDefinitions`）。
 *
 * ⚠ **`denominator` 由服务端从表派生返回**（I-5 逐字：「不许前端自己数、
 * 更不许任何一侧写 16 或 15」）。前端自己 `items.length` 是第二份事实——
 * 今天恒等，明天分母口径一变（比如引入「不计入分母的项」）就悄悄分叉。
 *
 * ⚠ 本用例**只 import domain**（洋葱：application → domain），没有仓储端口：
 * 定义表是产品的结构定义，不是组织配置。
 * ——对照 `uc-0-5` 的能力清单：**那**是组织配置，必须来自 `capability_listings`；
 * 这张表决定「蓝本设计器有哪些格子」，每个组织都一样。两者不要混。
 */

import {
  designFacetsByGroup,
  orderedDesignFacets,
  designFacetDenominator,
  DESIGN_FACET_DEFINITIONS,
  DESIGN_FACET_GROUPS,
  type DesignFacetGroup,
  type DesignFacetRow,
} from "../../domain/templates/design-facet-table";

/** 契约 `out` 的形状：`{ items, denominator }`。⚠ 逐字段列出即第二份定义，故用投影而非重述 */
export function listDesignFacetDefinitions(
  table: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS,
): { items: { designFacetKey: string; label: string; required: boolean; ordinal: number }[]; denominator: number } {
  return {
    // ⚠ 投影掉 `group`：契约的 DesignFacetDefinition 是 .strict() 的四字段，
    //   多带一个字段会被 safeParse 拒。分组表达不了这件事登记在
    //   domain/templates/design-facet-table.ts 的 DESIGN_FACET_CONTRACT_GAP。
    items: orderedDesignFacets(table).map(({ designFacetKey, label, required, ordinal }) => ({
      designFacetKey,
      label,
      required,
      ordinal,
    })),
    denominator: designFacetDenominator(table),
  };
}

/**
 * 五组视图 —— **契约面之外**的读法。
 *
 * uc-2-1 V1 要求「接口返回的设计配置项……分组为五组」，而契约的响应体带不动 `group`。
 * 在人类裁决之前，分组只在服务端内部可用：**宁可让它停在这一层，
 * 也不要让前端照着 UI 顺序自己再列一遍五组**——那就是 I-5 在防的第二份事实。
 */
export function listDesignFacetGroups(
  table: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS,
): { group: DesignFacetGroup; items: DesignFacetRow[] }[] {
  const buckets = designFacetsByGroup(table);
  // 五个桶恒存在，空组也出现：空组与「不分这一组」必须可分辨。
  return DESIGN_FACET_GROUPS.map((group) => ({ group, items: buckets[group] }));
}
