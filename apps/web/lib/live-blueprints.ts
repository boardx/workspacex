/**
 * 蓝本目录的真实 API 薄封装 —— 供 `/project/new`（新建项目向导步骤 1）使用。
 *
 * 同 `live-projects.ts` 的规矩：类型从 `@repo/contracts` 推导，不重新声明第二份形状。
 *
 * ## 为什么现在能接了
 *
 * `GET /blueprints`（`listBlueprints`）已在 F175（BP-01）落地——
 * `apps/api/src/interface/controllers/blueprint.controller.ts` 有真实控制器 + pg 仓储，
 * 不再是「契约签核、后端零实现」的状态。但**发布版本**（`POST /blueprints/:id/versions`，
 * 能拿到 `createProject` 需要的 `blueprintVersionId`）还没实现——所以这里只负责把目录
 * 列出来，选择动作本身仍然禁用，见 `new-project-flow.tsx` 头注。
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
