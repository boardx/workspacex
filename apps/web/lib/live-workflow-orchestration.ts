/**
 * 工作流编排（`workflow-screen.tsx`）的真实 API 薄封装（F26 契约 `getWorkflowOrchestration`）。
 *
 * `templates` 束各自成文件，不塞进 `live-project-prep.ts`（那份文件的头注明确限定
 * 「项目筹备（定题/分组）」）——同 `live-blueprints.ts` 已经确立的先例。类型从
 * `@repo/contracts` 推导，不重新声明。
 *
 * ⚠ #1680（`getWorkflowOrchestration` 的 controller/infra）在本文件落地时可能尚未合并
 *   到 main——那种情况下本函数会拿到 404（`ApiError`，`reasonCode: null`）。这是预期的
 *   契约先行状态，不是本文件的 bug；调用方（`workflow-screen.tsx`）按 `ApiError` 统一
 *   处理，不为这一种情况特殊分支。
 */
import { templates } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type WorkflowOrchestrationOut = z.infer<typeof templates.operations.getWorkflowOrchestration.out>;
export type OrchestrationCell = z.infer<typeof templates.OrchestrationCell>;
export type AgendaSegmentRef = z.infer<typeof templates.AgendaSegmentRef>;

export async function getWorkflowOrchestration(projectId: string): Promise<WorkflowOrchestrationOut> {
  return apiRequest<WorkflowOrchestrationOut>(
    templates.operations.getWorkflowOrchestration.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "GET" },
  );
}
