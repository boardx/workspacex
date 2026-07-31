/**
 * 用例：生成「套用后会初始化什么」六类一览（F21 / 契约 `templates.getInitializationPreview`）。
 *
 * 洋葱：application → domain，没有仓储端口——一览是当前草稿（已填的设计配置项）的
 * 纯派生，读的是调用方已经拿到的草稿状态，不在这里另开一次存储访问。
 *
 * ⚠ `tier` / `versionId` 入参今天**不参与派生**：时长档位 → 议程环节数的联动是 F19
 * 的范围（`design-signoff.md` 「F19 | 时长档位与议程环节表联动」），F19 尚未合入 main
 * （2026-08-01 现状：issue #128 仍 `status:in-progress`）。一览按「已填的设计配置项」
 * 生成足以覆盖 AC5「随配置实时变化」——档位变化引起的议程环节数变化，等 F19 落地后
 * 由同一个 planner 消费 F19 产出的议程环节清单，不需要改这个用例的签名。
 */

import {
  planInitializationPreview,
  toContractInitializationPreview,
  type InitializationCategory,
  type InitItemRow,
} from "../../domain/templates/initialization-preview";
import { DESIGN_FACET_DEFINITIONS, type DesignFacetRow } from "../../domain/templates/design-facet-table";

export interface InitializationPreviewView {
  readonly categories: readonly InitializationCategory[];
  readonly items: readonly InitItemRow[];
}

export function getInitializationPreview(
  input: { readonly filledFacetKeys: Iterable<string> },
  table: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS,
): InitializationPreviewView {
  const preview = planInitializationPreview(input.filledFacetKeys, table);
  return toContractInitializationPreview(preview);
}
