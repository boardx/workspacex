/**
 * 用例：**打开蓝本设计器**（F18 / `uc-2-1` R3 §3.0 + R8）。
 *
 * 外壳要显示的四件东西在这里一次算齐：版本条 · 三动作 · 五组目录 · 完成度。
 * 洋葱：application → domain，**没有仓储端口**——配置项定义表是产品的结构定义，
 * 每个组织都一样（对照 `uc-0-5` 的能力清单：**那**才是组织配置）。
 *
 * ## 为什么目录也从这里出，而不是让前端拿 `listDesignFacetDefinitions` 自己分组
 *
 * 契约的 `DesignFacetDefinition` 是 `.strict()` 的四字段、**带不动 `group`**
 * （`DESIGN_FACET_CONTRACT_GAP`，改契约是人类的动作）。前端若为了画五组自己再列一遍
 * 组名与归属，那正是 I-5 在防的第二份事实。⇒ 分组停在服务端，前端拿**已经分好组的目录**。
 */

import {
  DESIGN_FACET_DEFINITIONS,
  DESIGN_FACET_GROUPS,
  DESIGN_FACET_GROUP_LABEL,
  designFacetDenominator,
  designFacetsByGroup,
  type DesignFacetGroup,
  type DesignFacetRow,
} from "../../domain/templates/design-facet-table";
import { deriveCompleteness, type CompletenessResult } from "../../domain/templates/completeness";
import {
  deriveDesignerActions,
  deriveVersionBar,
  firstIncompleteRequiredFacet,
  type BlueprintBinding,
  type DesignerAction,
  type VersionBarFacts,
} from "../../domain/templates/designer-shell";
import type { BlueprintState, BlueprintVersion } from "../../domain/templates/blueprint-version";

export interface DesignerCatalogItem {
  readonly designFacetKey: string;
  readonly label: string;
  readonly required: boolean;
  readonly ordinal: number;
}

export interface DesignerCatalogGroup {
  readonly group: DesignFacetGroup;
  readonly label: string;
  readonly items: readonly DesignerCatalogItem[];
}

export interface DesignerCatalog {
  /** 五个组**恒存在**，空组也出现：空组与「我们不分这一组」必须可分辨 */
  readonly groups: readonly DesignerCatalogGroup[];
  /** ⚠ 服务端算的分母（I-5）。前端 `items.length` 是第二份事实，今天恒等、明天口径一变就分叉 */
  readonly denominator: number;
}

/** 目录 = 表 × 分组 × 组内序。**结构**，与具体某个蓝本填了多少无关 */
export function listDesignerCatalog(
  table: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS,
): DesignerCatalog {
  const buckets = designFacetsByGroup(table);
  return {
    groups: DESIGN_FACET_GROUPS.map((group) => ({
      group,
      label: DESIGN_FACET_GROUP_LABEL[group],
      items: buckets[group].map(({ designFacetKey, label, required, ordinal }) => ({
        designFacetKey,
        label,
        required,
        ordinal,
      })),
    })),
    denominator: designFacetDenominator(table),
  };
}

export interface DesignerShellView {
  readonly versionBar: VersionBarFacts;
  readonly actions: readonly DesignerAction[];
  readonly catalog: DesignerCatalog;
  readonly completeness: CompletenessResult;
  /** 完成度可点击的落点；今天恒 null 是**数据缺口 D-2**，不是没实现（见 domain 注释） */
  readonly firstIncompleteRequiredKey: string | null;
  /** 已完成的槽位。⚠ 界面据此打 ✓，**不自己判**哪一项算完成 */
  readonly completedKeys: readonly string[];
}

export function getDesignerShell(
  input: {
    readonly blueprint: { readonly state: BlueprintState; readonly bindings: readonly BlueprintBinding[] };
    readonly history: readonly BlueprintVersion[];
    readonly currentVersion: BlueprintVersion | null;
    readonly completedKeys: Iterable<string>;
  },
  table: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS,
): DesignerShellView {
  const completedKeys = [...input.completedKeys];
  const versionBar = deriveVersionBar(input.blueprint, input.history, input.currentVersion);
  return {
    versionBar,
    actions: deriveDesignerActions(versionBar),
    catalog: listDesignerCatalog(table),
    completeness: deriveCompleteness(completedKeys, table),
    firstIncompleteRequiredKey: firstIncompleteRequiredFacet(completedKeys, table),
    completedKeys,
  };
}
