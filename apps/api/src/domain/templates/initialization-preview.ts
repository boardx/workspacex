/**
 * 「套用后会初始化什么」六类一览的**生成器**（F21 / `uc-2-1` R6 AC5 / I-17）。
 *
 * 纯函数：没有时钟、没有 I/O、没有存储。输入是「当前草稿哪些设计配置项已填」，
 * 输出是六类恒存在的一览——这份契约（`templates.getInitializationPreview` /
 * `templates.InitItem` / `templates.InitializationCategory`）**与 `applyBlueprint`
 * 共用同一份**（uc-2-1 R11 第 6 项逐字），所以本文件导出的 `planInitializationPreview`
 * 就是 F23 落地「六类初始化事务写入」时要直接复用的那个 planner——
 * 「一览」与「实际写入」若各算各的，AC2「逐项对得上」就是自证的空转（I-17）。
 *
 * ## 六类是封闭枚举，恒 6，不随配置变
 *
 * `INITIALIZATION_CATEGORIES` 取自契约 `templates.InitializationCategory` 的枚举值本身
 * （不在本文件重复列举字面量），且**空类也要出现**：一次没有分组的草稿仍要在一览里看到
 * 「分组」这一类、只是 `items` 为空——「这次没有分组」与「我们不初始化分组」必须可分辨。
 *
 * ## 设计配置项 → 六类的映射**住在定义表本身**，不是本文件的第二张表
 *
 * 契约与 UC 都只说「各类的具体条目由被套用蓝本的各项设计配置决定」（uc-2-2「初始化的
 * 确定分母」），没有给出 15 项设计配置具体哪项落进哪一类的对照——这是**待补的判断**，
 * 不是待裁决的分叉：六类本身、类的顺序、`InitItem` 的形状都已经在契约里钉死，
 * 缺的只是这份判断本身。它被写成 `design-facet-table.ts` 每一行的 `initCategory` 字段，
 * **而不是本文件里另一个 `{ 15 个 key: category }` 的对照表**——后者正是
 * `lint-design-facet-single-source.mjs` 规则 2b 专门防的「第二份定义表跨行躲过单行检查」，
 * 该表已经因为承载 `group` / `required` 被机械门控钉成单源，`initCategory` 只是同一行
 * 多一列，不是另开一处副本。`topic-and-background` 的 `initCategory` 是 `null`：
 * 定题是 uc-2-2「定题单点继承」的**种子**，分组/议程/AI 上下文都从它继承而不是它本身
 * 作为一个初始化条目——记在表里，不留成一个无声漏项。
 */

import type { z } from "zod";
import { templates } from "@repo/contracts";
import { DESIGN_FACET_DEFINITIONS, isDesignFacetKey, type DesignFacetRow } from "./design-facet-table";

export type InitializationCategory = z.infer<typeof templates.InitializationCategory>;

/** 六类，**顺序与取值都来自契约本身**，本文件不重复写字面量数组。 */
export const INITIALIZATION_CATEGORIES: readonly InitializationCategory[] =
  templates.InitializationCategory.options;

export interface InitItemRow {
  readonly category: InitializationCategory;
  readonly key: string;
  readonly label: string;
}

export interface InitializationPreview {
  /** 恒 6 类，顺序固定，空类也出现（I-17） */
  readonly categories: readonly InitializationCategory[];
  readonly items: readonly InitItemRow[];
  /** 已填但表里 `initCategory` 为 null 的 key（今天只会是 `topic-and-background`）。⚠ 不静默丢弃 */
  readonly unmappedFacetKeys: readonly string[];
}

/**
 * 生成一览。**随 `filledFacetKeys` 实时变化**（V9）：同一份表，换一批已填的 key
 * 就换一批 `items`——这就是「随配置实时变化」在纯函数里的样子。
 *
 * ⚠ 不认识的 key（不在 `table` 里）既不计入 `items` 也不计入 `unmappedFacetKeys`，
 * 与 `deriveCompleteness` 对「表外 key」的处理口径一致（不静默、但也不冒充是本表的槽位）。
 */
export function planInitializationPreview(
  filledFacetKeys: Iterable<string>,
  table: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS,
): InitializationPreview {
  const items: InitItemRow[] = [];
  const unmapped: string[] = [];

  for (const key of filledFacetKeys) {
    if (!isDesignFacetKey(key, table)) continue;
    const row = table.find((r) => r.designFacetKey === key)!;
    const category = row.initCategory ?? null;
    if (category === null) {
      unmapped.push(key);
      continue;
    }
    items.push({ category, key: row.designFacetKey, label: row.label });
  }

  return {
    categories: INITIALIZATION_CATEGORIES,
    items,
    unmappedFacetKeys: unmapped,
  };
}

/** 契约 `getInitializationPreview.out` 的形状投影：只有 `categories` / `items` 两个字段。 */
export function toContractInitializationPreview(
  preview: InitializationPreview,
): { categories: readonly InitializationCategory[]; items: readonly InitItemRow[] } {
  return { categories: preview.categories, items: preview.items };
}
