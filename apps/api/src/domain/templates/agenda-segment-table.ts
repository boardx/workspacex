/**
 * 议程环节表 —— 时长档位驱动的议程环节集合（F19 / `uc-2-1` R3 步骤 1 主表 + A1 + AC4）。
 *
 * ## 这张表落的是什么，不落什么
 *
 * R3 主表给出的是**结构性事实**、逐字来自需求文档，不是本文件发明的：
 *
 * | 档位 | 半场数 | 议程环节数 | 增量内容 |
 * |---|---|---|---|
 * | 半天 | 1 | 7 | 只到收敛 |
 * | 一天 | 2 | 11 | 加商业模式草稿 |
 * | 两天（默认） | 4 | 14 | 加原型与用户测试 |
 * | 三天 | 6 | 19 | 加迭代与落地计划 |
 *
 * 四个计数与三个增量类别（商业模式草稿 / 原型与用户测试 / 迭代与落地计划）**逐字来自 R3**。
 * R3 **没有**给出这 19 个环节各自叫什么、第几个 —— 那是数据缺口，与
 * `design-facet-table.ts` 的「第 16 项」同一性质（O-07 那类「待补抽取」）。本表用
 * `<组>-<组内序>` 占位 key（如 `converge-1`），标题也是占位描述（如「收敛环节 1」），
 * **不得**被当成真实议程环节名称抄进界面文案或验收断言 —— 断言只应该看**数量与增删**，
 * 不应该看具体某个环节叫什么。
 *
 * ## `optional` 是本文件唯一做出的结构判断，登记在这里（不是对 D-8 的裁决）
 *
 * `domain.md` D-8 逐字：「可选/必留的划分」与「压缩时间的语义」**未裁决**、且与原型
 * 字面冲突（原型只说「环节表随之变化」，没有可选/必留之分）。但「议程环节数随档位变」
 * 本身是 R3 主表的既定事实——要同时满足「计数确实随档位变」与「換档位不得静默丟失
 * 已填内容」，本文件采用的结构是：
 *
 *   **基础的 7 个「收敛」环节在每一档都在场**（对应 Backlog 口径的「必留，只压缩时间」），
 *   **档位每升一级新增的那批环节标记为 `optional: true`**（升档自动加入、降档自动移除，
 *   移除后进 `recoverable`，「切回该档位可恢复」）。
 *
 * 这是为了让「计数随档位变」这件已知事实可运行而做的**结构判断**，不是对 D-8 的裁决——
 * 哪些环节的具体内容该必留、该叫什么名字仍待人类给出。已在 F19 的 PR/issue 收尾评论里
 * 报告为判断依据，供人类复核。
 */
import type { z } from "zod";
import { templates } from "@repo/contracts";

/** 契约的五值枚举（含 `custom`）。本文件只处理有明确规则的四档。 */
export type DurationTier = z.infer<typeof templates.DurationTier>;

/**
 * 四个可排序档位，**不含 `custom`**——`custom` 的规则本身未定义
 * （契约 `CUSTOM_TIER_RULE_UNDEFINED` / D-7「宁可拒绝也不猜一个推导式」）。
 */
export const ORDERED_DURATION_TIERS = [
  "half-day",
  "one-day",
  "two-day",
  "three-day",
] as const satisfies readonly DurationTier[];

export type OrderedDurationTier = (typeof ORDERED_DURATION_TIERS)[number];

export function isOrderedDurationTier(tier: DurationTier): tier is OrderedDurationTier {
  return (ORDERED_DURATION_TIERS as readonly string[]).includes(tier);
}

/** 四个增量分组，对应 R3 主表的「增量内容」列。 */
export type AgendaSegmentGroup =
  | "converge"
  | "business-model-draft"
  | "prototype-user-testing"
  | "iteration-landing-plan";

export interface AgendaSegmentRow {
  /** 占位 key（`<组>-<组内序>`）。⚠ 不是真实议程环节名，见文件头 */
  readonly segmentKey: string;
  /** 占位标题。⚠ 同上 */
  readonly title: string;
  readonly group: AgendaSegmentGroup;
  /** 引入该行所需的最低档位——该档及以上（按 `ORDERED_DURATION_TIERS` 序）均包含它 */
  readonly introducedAtTier: OrderedDurationTier;
  /** true ⇒ 降档时可被自动移除（进 `recoverable`）；false ⇒ 必留，只压缩时间（本文件的结构判断，见文件头） */
  readonly optional: boolean;
}

function group(
  key: AgendaSegmentGroup,
  count: number,
  introducedAtTier: OrderedDurationTier,
  optional: boolean,
  titlePrefix: string,
): AgendaSegmentRow[] {
  return Array.from({ length: count }, (_, i) => ({
    segmentKey: `${key}-${i + 1}`,
    title: `${titlePrefix} ${i + 1}`,
    group: key,
    introducedAtTier,
    optional,
  }));
}

/**
 * 表本体。四段合计 7 + 4 + 3 + 5 = 19，与三天档的议程环节数一致（`AGENDA_TABLE_MATCHES_R3` 断言此不变量）。
 * 改这里，各档位的议程环节数与增删全部自动跟着变。
 */
export const AGENDA_SEGMENT_DEFINITIONS: readonly AgendaSegmentRow[] = [
  ...group("converge", 7, "half-day", false, "收敛环节"),
  ...group("business-model-draft", 4, "one-day", true, "商业模式草稿环节"),
  ...group("prototype-user-testing", 3, "two-day", true, "原型与用户测试环节"),
  ...group("iteration-landing-plan", 5, "three-day", true, "迭代与落地计划环节"),
];

function tierRank(tier: OrderedDurationTier): number {
  return ORDERED_DURATION_TIERS.indexOf(tier);
}

/** 该档位在场的行（`introducedAtTier` 的档位 ≤ 目标档位），**按定义顺序**。 */
export function agendaSegmentsForTier(
  tier: OrderedDurationTier,
  table: readonly AgendaSegmentRow[] = AGENDA_SEGMENT_DEFINITIONS,
): AgendaSegmentRow[] {
  const rank = tierRank(tier);
  return table.filter((r) => tierRank(r.introducedAtTier) <= rank);
}

/**
 * 议程环节数 = 该档位在场行数。
 * ⚠ 这是一个**函数**而不是一张按档位硬编码 7/11/14/19 的常量表：常量会被 import 到
 * 别处再存一遍，那正是 I-5 同款漂移在这个域里的翻版。
 */
export function agendaSegmentCountForTier(
  tier: OrderedDurationTier,
  table: readonly AgendaSegmentRow[] = AGENDA_SEGMENT_DEFINITIONS,
): number {
  return agendaSegmentsForTier(tier, table).length;
}
