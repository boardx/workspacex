/**
 * 蓝本的真实 API 薄封装。
 *
 * 同 `live-projects.ts` 的规矩：类型从 `@repo/contracts` 推导，不重新声明第二份形状。
 *
 * ## 历史与现状
 *
 * 最早只为 `/project/new`（新建项目向导步骤 1）封装了 `listBlueprints`——那时
 * 发布版本还没实现，选择动作本身禁用。BP-04（F179）已把发布/试跑接上电，
 * BP-05 在此基础上补齐「项目模板」生产入口（`/tpl/list`）需要的
 * `createBlueprint`/`updateDesignFacet`，供列表页新建、设计器编辑设计环节用。
 *
 * ## 契约缺口 T13：`setDurationTier` 需要的 `expectedVersion` 没有读路径
 *
 * `packages/contracts/src/templates.ts` `KNOWN_CONTRACT_GAPS.T13` 已如实登记：
 * `listBlueprints.out`（`BlueprintRow`）不含蓝本行级的乐观并发令牌，也没有
 * `getBlueprint` 单条读操作。⇒ **本文件不封装 `setDurationTier`**——不是漏做，
 * 是没有合法输入可以喂给它。等这个读路径缺口被补上（新增 `getBlueprint` 或把
 * 令牌塞进 `listBlueprints.out`，两者都需要走 delta 重签），再补这个函数。
 * BP-03（F177）的后端本身真实、可测，只是前端暂时够不到——「设时长档位」
 * 因此不在本次 BP-05 的接线范围内，P3 仍停在🟡。
 *
 * `createBlueprint`/`listBlueprints`/`updateDesignFacet` 不受这个缺口影响：
 * 前两个不需要令牌，后者的令牌是每个设计配置项自己的 `itemRevision`
 * （首次调用用哨兵 `''`），跟蓝本行级的 `expectedVersion` 是两回事。
 */
import { templates } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type BlueprintRow = z.infer<typeof templates.BlueprintRow>;

export async function listBlueprints(orgId: string): Promise<BlueprintRow[]> {
  return apiRequest<BlueprintRow[]>(templates.operations.listBlueprints.path, {
    method: "GET",
    query: { orgId },
  });
}

export const BLUEPRINT_STATE_LABEL: Record<z.infer<typeof templates.BlueprintState>, string> = {
  draft: "草稿",
  published: "已发布",
  archived: "已归档",
};

export const DURATION_TIER_LABEL: Record<z.infer<typeof templates.DurationTier>, string> = {
  "half-day": "半天",
  "one-day": "一天",
  "two-day": "两天",
  "three-day": "三天",
  custom: "自定义",
};

export type CreateBlueprintOut = z.infer<typeof templates.operations.createBlueprint.out>;
export type BlueprintOrigin = z.infer<typeof templates.BlueprintOrigin>;

export interface CreateBlueprintInput {
  readonly orgId: string;
  readonly name: string;
  readonly origin: Extract<BlueprintOrigin, "blank" | "copy">;
  /** `copy` 时是源蓝本 id；`blank` 时为 null */
  readonly sourceId: string | null;
}

export async function createBlueprint(input: CreateBlueprintInput): Promise<CreateBlueprintOut> {
  return apiRequest<CreateBlueprintOut>(templates.operations.createBlueprint.path, {
    method: "POST",
    body: input,
  });
}

export type UpdateDesignFacetOut = z.infer<typeof templates.operations.updateDesignFacet.out>;

export interface UpdateDesignFacetInput {
  readonly blueprintId: string;
  readonly designFacetKey: string;
  readonly value: string;
  /** 哨兵 `''` = 「我以为这一项还没人填过」，同后端约定 */
  readonly expectedItemRevision: string;
}

export async function updateDesignFacet(input: UpdateDesignFacetInput): Promise<UpdateDesignFacetOut> {
  return apiRequest<UpdateDesignFacetOut>(
    templates.operations.updateDesignFacet.path
      .replace(":blueprintId", encodeURIComponent(input.blueprintId))
      .replace(":designFacetKey", encodeURIComponent(input.designFacetKey)),
    { method: "PUT", body: { value: input.value, expectedItemRevision: input.expectedItemRevision } },
  );
}
