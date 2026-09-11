/**
 * issue #3440 —— composer 开关「自动批准文档生成所需权限」的真实 API 薄封装，
 * 跟 `live-org-admin.ts` 同一个模式：类型从 `@repo/contracts` 推导，调用一律走
 * `apiRequest`（真实鉴权，不是 mock）。
 */
import { planPermissions } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type DocumentGenerationAutoApproveStatus = z.infer<typeof planPermissions.DocumentGenerationAutoApproveStatus>;

export async function getDocumentGenerationAutoApprove(): Promise<DocumentGenerationAutoApproveStatus> {
  return apiRequest<DocumentGenerationAutoApproveStatus>(
    planPermissions.operations.getDocumentGenerationAutoApprove.path, { method: "GET" },
  );
}

export async function setDocumentGenerationAutoApprove(enabled: boolean): Promise<DocumentGenerationAutoApproveStatus> {
  return apiRequest<DocumentGenerationAutoApproveStatus>(
    planPermissions.operations.setDocumentGenerationAutoApprove.path, { method: "PUT", body: { enabled } },
  );
}
