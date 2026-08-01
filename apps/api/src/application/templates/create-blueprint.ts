/**
 * 用例：新建蓝本三入口（F22 / 契约 `templates.createBlueprint`）。
 *
 * 只做编排：按 `origin` 分派到对应的领域 plan 函数，再把结果投影成契约 out 形状。
 * `blueprintId` 由调用方生成并传入（同 `startTrialRun` 惯例，本层不碰 ID 生成策略）；
 * `orgId` / `name` 契约要求但不参与本用例的判定逻辑，落库时由控制器层原样带上。
 */

import { templates } from "@repo/contracts";
import type { z } from "zod";
import {
  planBlankBlueprint,
  planCopyBlueprint,
  planReverseFromProject,
} from "../../domain/templates/create-blueprint";
import { DESIGN_FACET_DEFINITIONS, type DesignFacetRow } from "../../domain/templates/design-facet-table";

export type CreateBlueprintOutput = z.infer<typeof templates.operations.createBlueprint.out>;
export type BlueprintOrigin = z.infer<typeof templates.BlueprintOrigin>;

export type CreateBlueprintInput =
  | { readonly origin: "blank"; readonly blueprintId: string }
  | {
      readonly origin: "copy";
      readonly blueprintId: string;
      /** 已从源蓝本（`sourceId`）读出的已填内容——由调用方解析，本用例不读存储 */
      readonly sourceContent: Readonly<Record<string, string>>;
    }
  | {
      readonly origin: "reverse-from-project";
      readonly blueprintId: string;
      /** 已从源项目（`sourceId`）算出的「designFacetKey → 值」映射——由调用方解析 */
      readonly mappedFacets: ReadonlyMap<string, string>;
    };

export function createBlueprint(
  input: CreateBlueprintInput,
  table: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS,
): CreateBlueprintOutput {
  const plan =
    input.origin === "blank"
      ? planBlankBlueprint()
      : input.origin === "copy"
        ? planCopyBlueprint(input.sourceContent)
        : planReverseFromProject(input.mappedFacets, table);

  return {
    blueprintId: input.blueprintId,
    unmappedDesignFacetKeys: [...plan.unmappedDesignFacetKeys],
    machineGenerated: plan.machineGenerated,
  };
}
