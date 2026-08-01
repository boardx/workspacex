/**
 * 套用蓝本新建项目 —— 六类初始化写入计划（F23 / `uc-2-2` R3 / 契约 `templates.applyBlueprint`）。
 *
 * 纯函数：没有时钟、没有 I/O、没有存储。给定「这一版蓝本哪些设计配置项已填」与
 * 「选中的时长档位」，算出六类各自要写入多少条、以及议程环节具体是哪几行。
 * 落库、事务边界与幂等由 `application/templates/apply-blueprint.ts` 的仓储端口负责——
 * 本文件只回答「写什么」，不回答「怎么原子地写」。
 *
 * ## 为什么不是新写一张「六类 → 数量」的对照表
 *
 * `initialization-preview.ts`（F21）已经证明「一览」与「实际写入」**必须共用同一个 planner**
 * （AC2「逐项对得上」的字面要求），否则两者各自维护就是本仓第十次「同一事实两处声明」。
 * 本文件因此**不重新判断**「哪个设计配置项落进哪一类」——那张判断表已经钉死在
 * `design-facet-table.ts` 的 `initCategory` 列，本文件只是在 `planInitializationPreview`
 * 的输出上再叠一层「算出条数」。
 *
 * ## 「议程环节」为什么是唯一的例外
 *
 * AC1 逐字：「打开即有完整议程环节（数量=所选档位）」——这是一条**结构性事实**
 * （`agenda-segment-table.ts` / F19），与「`flow-agenda` 这个设计配置项有没有被填」无关：
 * 即使调用方一个设计配置项都没填，套用蓝本后议程环节仍然按档位齐全地出现，
 * 不然「打开即有完整议程环节」这句 AC 就要看运气。所以 `议程环节` 这一类的
 * `count` 恒等于 `agendaSegmentCountForTier(tier)`，**不是** `planInitializationPreview`
 * 给出的「有几个设计配置项映射到这一类」的计数（那个数字只有 0/1/2，从来不是「7/11/14/19」）。
 *
 * 其余五类（分组 / 角色分工 / 材料清单 / 会前任务 / 画布与产出物）在 F24-F29 落地前
 * 没有更深的领域模型可数（真实的分组数、真实的产出物件数都是后续 feature 的交付物），
 * 所以 `count` = 该类在一览里的条目数——这与「一览逐项对得上」的字面要求完全一致：
 * 一览说这一类有几条，套用就写几条。
 */

import type { z } from "zod";
import { templates } from "@repo/contracts";
import {
  planInitializationPreview,
  type InitializationCategory,
  type InitItemRow,
} from "./initialization-preview";
import { DESIGN_FACET_DEFINITIONS, type DesignFacetRow } from "./design-facet-table";
import {
  AGENDA_SEGMENT_DEFINITIONS,
  agendaSegmentCountForTier,
  agendaSegmentsForTier,
  isOrderedDurationTier,
  type AgendaSegmentRow,
} from "./agenda-segment-table";
import type { AgendaSegmentRefLike } from "./duration-tier";

export type DurationTier = z.infer<typeof templates.DurationTier>;

/** 契约恒 6 类，**顺序取自契约本身**，本文件不重复写字面量数组。 */
export const SIX_CATEGORIES: readonly InitializationCategory[] = templates.InitializationCategory.options;

/** 契约 `applyBlueprint.out.initialized` 单行的形状。 */
export interface CategoryInitCount {
  readonly category: InitializationCategory;
  readonly count: number;
}

export interface SixCategoryInitPlan {
  /** 恒 6 类，顺序固定，即使某一类今天 count 为 0 也要出现（同 I-17 的理由） */
  readonly initialized: readonly CategoryInitCount[];
  /** 「议程环节」这一类的具体行，数量 = 所选档位（AC1）——供仓储写入实际议程环节表 */
  readonly agendaSegments: readonly AgendaSegmentRefLike[];
  /** 与一览共用的 items，供上层核对「逐项对得上」（AC2）而不必重新调用一次 planner */
  readonly previewItems: readonly InitItemRow[];
}

/**
 * 生成六类写入计划。
 *
 * ⚠ `filledFacetKeys` 决定除「议程环节」外五类各自的条目（与一览同源）；
 * `tier` 决定「议程环节」这一类的真实条数与具体行——两者是两条独立的输入，
 * 混成一条（比如靠 `flow-agenda` 是否在 `filledFacetKeys` 里来决定要不要写议程环节）
 * 会让「打开即有完整议程环节」在「没人填流程配置」时静默失效。
 */
export function planSixCategoryInit(
  filledFacetKeys: Iterable<string>,
  tier: DurationTier,
  facetTable: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS,
  agendaTable: readonly AgendaSegmentRow[] = AGENDA_SEGMENT_DEFINITIONS,
): SixCategoryInitPlan {
  const preview = planInitializationPreview(filledFacetKeys, facetTable);

  const agendaCategory: InitializationCategory = "议程环节";
  const ordered = isOrderedDurationTier(tier) ? tier : null;
  const agendaCount = ordered === null ? 0 : agendaSegmentCountForTier(ordered, agendaTable);
  const agendaSegments: readonly AgendaSegmentRefLike[] =
    ordered === null ? [] : agendaSegmentsForTier(ordered, agendaTable).map(toAgendaRef);

  const initialized: CategoryInitCount[] = SIX_CATEGORIES.map((category) => {
    if (category === agendaCategory) {
      return { category, count: agendaCount };
    }
    const count = preview.items.filter((item) => item.category === category).length;
    return { category, count };
  });

  return { initialized, agendaSegments, previewItems: preview.items };
}

function toAgendaRef(row: AgendaSegmentRow): AgendaSegmentRefLike {
  return { agendaSegmentId: row.segmentKey, title: row.title, addedBy: null, optional: row.optional };
}
