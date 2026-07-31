/**
 * gen-agenda-tier-catalog.ts —— 把**议程环节表**投影给前端（F19 / R3 主表 / AC4）。
 *
 * 唯一事实源是 `apps/api/src/domain/templates/agenda-segment-table.ts`，而 `apps/web`
 * **不能 import `apps/api`**（洋葱与包边界）。于是「换档位表单」面对同 F18 的
 * `gen-design-facet-catalog.ts` 一样三条路，选的也是同一条：③ 构建期从表派生一份带
 * `@generated` 标记的投影，配漂移门控。
 *
 * ## 用法
 *
 *   pnpm exec tsx scripts/gen-agenda-tier-catalog.ts            # 写盘
 *   pnpm exec tsx scripts/gen-agenda-tier-catalog.ts --check    # 只比对，漂移则退出 1
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  ORDERED_DURATION_TIERS,
  agendaSegmentCountForTier,
} from "../src/domain/templates/agenda-segment-table";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const OUT = join(ROOT, "apps/web/lib/generated/agenda-tier-catalog.ts");
const GENERATOR = "apps/api/scripts/gen-agenda-tier-catalog.ts";

function render(): string {
  const rows = ORDERED_DURATION_TIERS.map((tier) => ({
    tier,
    agendaSegmentCount: agendaSegmentCountForTier(tier),
  }));
  return `/**
 * @generated 由 ${GENERATOR} 从
 * \`apps/api/src/domain/templates/agenda-segment-table.ts\` 派生，**请勿手改**。
 *
 * 改这里不会改变定义表，只会让表单与后端的议程环节数漂移——「同一事实声明在两处必然漂移」
 * 是本仓已踩过九次的坑。要改请改定义表，然后跑：
 *   pnpm --filter @repo/api exec tsx scripts/gen-agenda-tier-catalog.ts
 *
 * 门控：pnpm --filter @repo/api exec tsx scripts/gen-agenda-tier-catalog.ts --check
 * （\`blueprint-duration-form.test.tsx\` 会跑一次）
 */

/** 四个可排序档位（不含 \`custom\`：其规则未定，见契约 \`CUSTOM_TIER_RULE_UNDEFINED\`） */
export type AgendaTierKey = "half-day" | "one-day" | "two-day" | "three-day";

export interface AgendaTierCatalogRow {
  readonly tier: AgendaTierKey;
  /** 议程环节数。⚠ 服务端派生，前端不许自己数 */
  readonly agendaSegmentCount: number;
}

export const AGENDA_TIER_CATALOG: readonly AgendaTierCatalogRow[] = ${JSON.stringify(rows, null, 2)};
`;
}

const body = render();

if (process.argv.includes("--check")) {
  if (!existsSync(OUT)) {
    console.error(`✗ ${OUT} 不存在 —— 先跑一次生成器`);
    process.exit(1);
  }
  const onDisk = readFileSync(OUT, "utf8");
  if (onDisk !== body) {
    console.error("✗ [drift] apps/web/lib/generated/agenda-tier-catalog.ts 与定义表不一致");
    console.error("    要么它被手改了，要么定义表变了没重新生成。");
    console.error(`    修：pnpm --filter @repo/api exec tsx ${GENERATOR}`);
    process.exit(1);
  }
  console.log("✅ agenda tier catalog is in sync with the definition table");
} else {
  writeFileSync(OUT, body);
  console.log(`✓ wrote ${OUT}`);
}
