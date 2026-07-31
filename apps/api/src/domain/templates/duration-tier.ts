/**
 * 换时长档位 —— 与议程环节表联动（F19 / `uc-2-1` R3 步骤 1 + A1 + AC4，契约 `setDurationTier`）。
 *
 * 纯函数：没有时钟、没有 I/O、没有存储。给定当前档位、目标档位、是否已确认，
 * 算出议程环节表要增删哪些行。
 *
 * ## 为什么只在「有东西会消失」时才要求确认
 *
 * 契约注释：「换档位是破坏性变更（R8），`confirmed: false` ⇒
 * `TIER_CHANGE_NEEDS_CONFIRMATION` + 将被增删的议程环节清单」。「破坏性」指的是
 * **会丢内容**这件事——升档只是新增环节，没有任何东西消失，不构成破坏性变更；
 * 只有降档（或换到一个环节更少的档位）会移除环节，才需要用户确认。
 * 首次为新蓝本选档位（`currentTier: null`）没有旧内容可比较，同理不需要确认。
 *
 * ## 「已填内容不得静默丢弃」（A2）落在哪里
 *
 * 被移除的行在 `agenda-segment-table.ts` 里全部标记 `optional: true`
 * （本文件的结构判断，见该文件文件头），所以 `removed` 的每一项都进 `recoverable`——
 * 提示「切回该档位可恢复」，不是真的从表定义里删掉。
 */
import {
  AGENDA_SEGMENT_DEFINITIONS,
  agendaSegmentCountForTier,
  agendaSegmentsForTier,
  type AgendaSegmentRow,
  type DurationTier,
  type OrderedDurationTier,
} from "./agenda-segment-table";

/** 契约 `AgendaSegmentRef` 同形状的纯 TS 接口（不重复 import zod schema，见 `contract-single-source.test.ts`）。 */
export interface AgendaSegmentRefLike {
  readonly agendaSegmentId: string;
  readonly title: string;
  readonly addedBy: string | null;
  readonly optional: boolean;
}

function toRef(row: AgendaSegmentRow): AgendaSegmentRefLike {
  // 档位本身引入的环节不算「由某条设置自动加入」（那是 `format-setting` 那类跨设置的
  // 副作用专属的语义，见 `format-language.ts`）——它们就是该档位流程 Agenda 的内容本身。
  return { agendaSegmentId: row.segmentKey, title: row.title, addedBy: null, optional: row.optional };
}

export type DurationTierChangeResult =
  | { readonly kind: "custom-tier-undefined" }
  | {
      readonly kind: "confirmation-required";
      readonly added: readonly AgendaSegmentRefLike[];
      readonly removed: readonly AgendaSegmentRefLike[];
    }
  | {
      readonly kind: "applied";
      readonly agendaSegmentCount: number;
      readonly added: readonly AgendaSegmentRefLike[];
      readonly removed: readonly AgendaSegmentRefLike[];
      /** A2：被移除的都可恢复（本表的移除行恒为 optional，见 `agenda-segment-table.ts`） */
      readonly recoverable: readonly AgendaSegmentRefLike[];
    };

export interface PlanDurationTierChangeInput {
  /** null ⇒ 新蓝本首次选档位，没有旧档位可比较，不构成破坏性变更 */
  readonly currentTier: OrderedDurationTier | null;
  readonly targetTier: DurationTier;
  readonly confirmed: boolean;
}

export function planDurationTierChange(
  input: PlanDurationTierChangeInput,
  table: readonly AgendaSegmentRow[] = AGENDA_SEGMENT_DEFINITIONS,
): DurationTierChangeResult {
  if (input.targetTier === "custom") return { kind: "custom-tier-undefined" };

  const targetRows = agendaSegmentsForTier(input.targetTier, table);
  const currentRows = input.currentTier === null ? [] : agendaSegmentsForTier(input.currentTier, table);

  const currentKeys = new Set(currentRows.map((r) => r.segmentKey));
  const targetKeys = new Set(targetRows.map((r) => r.segmentKey));

  const added = targetRows.filter((r) => !currentKeys.has(r.segmentKey)).map(toRef);
  const removed = currentRows.filter((r) => !targetKeys.has(r.segmentKey)).map(toRef);

  // 只有「会丢东西」才是破坏性变更；纯新增（升档）不需要确认。
  if (!input.confirmed && removed.length > 0) {
    return { kind: "confirmation-required", added, removed };
  }

  return {
    kind: "applied",
    agendaSegmentCount: agendaSegmentCountForTier(input.targetTier, table),
    added,
    removed,
    recoverable: removed.filter((r) => r.optional),
  };
}
