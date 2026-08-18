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
 * BP-06 前置（F186）补上 `getBlueprintDesignFacets`，给设计器页面读真实内容。
 *
 * ## 契约缺口 T13 已解决——`getBlueprintDesignFacets` 补上了这个读路径
 *
 * 之前 `KNOWN_CONTRACT_GAPS.T13` 登记的缺口（`setDurationTier` 需要的
 * `expectedVersion` 没有任何操作读得到）已经被 `getBlueprintDesignFacets.out.revision`
 * 解决——`setDurationTier` 因此可以封装了（本文件仍未封装，是因为设计器页面本身
 * 还没有换档位的界面交互，不是契约层面卡住了，属于设计器接线的下一个增量）。
 * `KNOWN_CONTRACT_GAPS.T13` 的文档措辞留给人类更新（不是本文件能单方改的事）。
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

export type GetBlueprintDesignFacetsOut = z.infer<typeof templates.operations.getBlueprintDesignFacets.out>;

/** BP-06 前置（F186）：读一个蓝本已填的设计环节内容 + 蓝本级并发令牌。 */
export async function getBlueprintDesignFacets(blueprintId: string): Promise<GetBlueprintDesignFacetsOut> {
  return apiRequest<GetBlueprintDesignFacetsOut>(
    templates.operations.getBlueprintDesignFacets.path.replace(":blueprintId", encodeURIComponent(blueprintId)),
    { method: "GET" },
  );
}

export type GetInitializationPreviewOut = z.infer<typeof templates.operations.getInitializationPreview.out>;

/**
 * 第 16 项「基本配置」聚合页用：套用后会初始化什么（六类恒定，空类也出现）。
 *
 * ⚠ 契约的 `versionId`/`tier` 两个入参**不参与派生**（后端 `getInitializationPreview`
 * 应用层文件头注已注明：预览按当前草稿的已填 facet key 生成），因此这里不发送它们——
 * 发一个不被消费的参数只会让人以为"换个 tier 能预览另一种结果"。
 */
export async function getInitializationPreview(blueprintId: string): Promise<GetInitializationPreviewOut> {
  return apiRequest<GetInitializationPreviewOut>(
    templates.operations.getInitializationPreview.path.replace(":blueprintId", encodeURIComponent(blueprintId)),
    { method: "GET" },
  );
}

export type SetDurationTierOut = z.infer<typeof templates.operations.setDurationTier.out>;
export interface SetDurationTierInput {
  readonly blueprintId: string;
  readonly tier: z.infer<typeof templates.operations.setDurationTier.in>["tier"];
  readonly confirmed: boolean;
  /** 乐观并发：取自 `listBlueprints` 那一行的 `versionNumber`。 */
  readonly expectedVersion: string;
}

/**
 * 第 16 项「基本配置」聚合页用：换时长档位（会增删可选环节）。
 *
 * ⚠ `confirmed: false` 是**预检**——后端返回 `CONFIRMATION_REQUIRED` 并附带将被增删的
 * 环节，界面据此让人先看清再决定；`confirmed: true` 才真正落库。前端不得跳过预检直接
 * 提交（那等于替用户拍板删环节）。
 */
export async function setDurationTier(input: SetDurationTierInput): Promise<SetDurationTierOut> {
  return apiRequest<SetDurationTierOut>(
    templates.operations.setDurationTier.path.replace(":blueprintId", encodeURIComponent(input.blueprintId)),
    {
      method: "PUT",
      body: { tier: input.tier, confirmed: input.confirmed, expectedVersion: input.expectedVersion },
    },
  );
}
