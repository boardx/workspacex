/**
 * `viewer-role` 束（phase-10 F02）的真实 API 薄封装——`tab-live.tsx` 视角切换器的
 * 服务端权威数据源。同 `live-project-prep.ts` 已确立的先例：`templates` 束各自成文件，
 * 契约束也一样。类型从 `@repo/contracts` 推导，不重新声明。
 */
import { viewerRole } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type ViewerOptionsOut = z.infer<typeof viewerRole.operations.getViewerOptions.out>;
export type ViewerOption = ViewerOptionsOut["viewers"][number];

export async function getViewerOptions(projectId: string, requestedViewerId?: string): Promise<ViewerOptionsOut> {
  const qs = requestedViewerId !== undefined ? `?requestedViewerId=${encodeURIComponent(requestedViewerId)}` : "";
  return apiRequest<ViewerOptionsOut>(
    viewerRole.operations.getViewerOptions.path.replace(":projectId", encodeURIComponent(projectId)) + qs,
    { method: "GET" },
  );
}
