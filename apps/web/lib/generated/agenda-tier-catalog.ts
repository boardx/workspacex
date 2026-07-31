/**
 * @generated 由 apps/api/scripts/gen-agenda-tier-catalog.ts 从
 * `apps/api/src/domain/templates/agenda-segment-table.ts` 派生，**请勿手改**。
 *
 * 改这里不会改变定义表，只会让表单与后端的议程环节数漂移——「同一事实声明在两处必然漂移」
 * 是本仓已踩过九次的坑。要改请改定义表，然后跑：
 *   pnpm --filter @repo/api exec tsx scripts/gen-agenda-tier-catalog.ts
 *
 * 门控：pnpm --filter @repo/api exec tsx scripts/gen-agenda-tier-catalog.ts --check
 * （`blueprint-duration-form.test.tsx` 会跑一次）
 */

/** 四个可排序档位（不含 `custom`：其规则未定，见契约 `CUSTOM_TIER_RULE_UNDEFINED`） */
export type AgendaTierKey = "half-day" | "one-day" | "two-day" | "three-day";

export interface AgendaTierCatalogRow {
  readonly tier: AgendaTierKey;
  /** 议程环节数。⚠ 服务端派生，前端不许自己数 */
  readonly agendaSegmentCount: number;
}

export const AGENDA_TIER_CATALOG: readonly AgendaTierCatalogRow[] = [
  {
    "tier": "half-day",
    "agendaSegmentCount": 7
  },
  {
    "tier": "one-day",
    "agendaSegmentCount": 11
  },
  {
    "tier": "two-day",
    "agendaSegmentCount": 14
  },
  {
    "tier": "three-day",
    "agendaSegmentCount": 19
  }
];
