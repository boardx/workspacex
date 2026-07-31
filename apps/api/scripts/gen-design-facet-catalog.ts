/**
 * gen-design-facet-catalog.ts —— 把**配置项定义表**投影给前端（F18 / I-5）。
 *
 * ## 为什么需要它
 *
 * 唯一事实源是 `apps/api/src/domain/templates/design-facet-table.ts`，而 `apps/web`
 * **不能 import `apps/api`**（洋葱与包边界）。于是设计器侧栏面对三条路：
 *   ① 前端自己写一份 15 行的目录 —— 这就是 I-5 在防的第二份事实，本仓已九次栽在这。
 *   ② 运行时调 `listDesignFacetDefinitions` —— 正确终局，但契约的 `.strict()` 四字段
 *      **带不动 `group`**（`DESIGN_FACET_CONTRACT_GAP`，改契约是人类的动作），
 *      而侧栏必须分五组；且 templates 的 HTTP 路由今天还不存在。
 *   ③ **构建期从表派生一份带 `@generated` 标记的投影，配漂移门控** —— 本脚本。
 * ③ 与 `packages/contracts` → `apps/web/lib/generated/*.mock.ts` 是同一个套路
 *   （ADR-020）：副本允许存在，**但它必须是机械生成的、且有门控证明它没被手改**。
 *
 * ## 用法
 *
 *   pnpm exec tsx scripts/gen-design-facet-catalog.ts            # 写盘
 *   pnpm exec tsx scripts/gen-design-facet-catalog.ts --check    # 只比对，漂移则退出 1
 *
 * `--check` 挂在 `apps/api` 的 `lint` 上：改了定义表却没重新生成 ⇒ 红。
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { listDesignerCatalog } from "../src/application/templates/get-designer-shell";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const OUT = join(ROOT, "apps/web/lib/generated/design-facet-catalog.ts");
const GENERATOR = "apps/api/scripts/gen-design-facet-catalog.ts";

function render(): string {
  const catalog = listDesignerCatalog();
  return `/**
 * @generated 由 ${GENERATOR} 从
 * \`apps/api/src/domain/templates/design-facet-table.ts\` 派生，**请勿手改**。
 *
 * 改这里不会改变定义表，只会让侧栏与后端分母漂移——而「同一事实声明在两处必然漂移」
 * 是本仓已踩过九次的坑。要改请改定义表，然后跑：
 *   pnpm --filter @repo/api exec tsx scripts/gen-design-facet-catalog.ts
 *
 * 门控：pnpm --filter @repo/api exec tsx scripts/gen-design-facet-catalog.ts --check
 * （挂在 @repo/api 的 lint 上；\`blueprint-designer-shell.test.tsx\` 也会跑一次）
 */

/** 目录里的一项。字段与 \`DesignFacetDefinition\` 同源，外加契约今天带不动的 \`group\`（分组由本文件的结构表达） */
export interface DesignFacetCatalogItem {
  readonly designFacetKey: string;
  readonly label: string;
  /** 发布门槛的唯一驱动（I-6）。今天全 false 是**数据缺口 D-2**，不是没有门 */
  readonly required: boolean;
  /** 组内序 */
  readonly ordinal: number;
}

export interface DesignFacetCatalogGroup {
  readonly group: string;
  readonly label: string;
  readonly items: readonly DesignFacetCatalogItem[];
}

export interface DesignFacetCatalog {
  /** 五个组恒存在，空组也出现 */
  readonly groups: readonly DesignFacetCatalogGroup[];
  /** ⚠ 分母由服务端算，前端**不许**数 \`items.length\` */
  readonly denominator: number;
}

export const DESIGN_FACET_CATALOG: DesignFacetCatalog = ${JSON.stringify(catalog, null, 2)};
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
    console.error("✗ [drift] apps/web/lib/generated/design-facet-catalog.ts 与定义表不一致");
    console.error("    要么它被手改了，要么定义表变了没重新生成。");
    console.error(`    修：pnpm --filter @repo/api exec tsx ${GENERATOR}`);
    process.exit(1);
  }
  console.log("✅ design-facet catalog is in sync with the definition table");
} else {
  writeFileSync(OUT, body);
  console.log(`✓ wrote ${OUT}`);
}
