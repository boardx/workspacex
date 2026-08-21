/**
 * 工作流编排（`workflow-screen.tsx`）的真实 API 薄封装（F26 契约 `getWorkflowOrchestration`
 * / `saveAsOrgTemplate`）。
 *
 * `templates` 束各自成文件，不塞进 `live-project-prep.ts`（那份文件的头注明确限定
 * 「项目筹备（定题/分组）」）——同 `live-blueprints.ts` 已经确立的先例。类型从
 * `@repo/contracts` 推导，不重新声明。
 *
 * ⚠ #1680（`getWorkflowOrchestration`/`saveAsOrgTemplate` 的 controller/infra）在本文件
 *   首次落地时可能尚未合并到 main——那种情况下本文件的函数会拿到 404（`ApiError`，
 *   `reasonCode: null`）。这是预期的契约先行状态，不是本文件的 bug；调用方按 `ApiError`
 *   统一处理，不为这一种情况特殊分支。
 *
 * ⚠ 2026-08-21（#1666 收尾）：`saveAsOrgTemplate` 是 `tab-prep.tsx` 的
 * `project-prep-save-template` 按钮与 `workflow-screen.tsx` 的 `tpl-wf-saveorg` 按钮**唯一**
 * 的真实调用点——两处按钮语义相同（都是「把这个项目此刻的工作流编排另存成一条新的
 * 后台工作流模板目录项」），不各自重写一份请求逻辑，也不各自重写一份
 * `describeSaveAsOrgTemplateError`（同一操作的错误码翻译只写一份，见本文件
 * `describeSaveAsOrgTemplateError` 的头注）。
 */
import { templates } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest, ApiError } from "./api-client";

export type WorkflowOrchestrationOut = z.infer<typeof templates.operations.getWorkflowOrchestration.out>;
export type OrchestrationCell = z.infer<typeof templates.OrchestrationCell>;
export type AgendaSegmentRef = z.infer<typeof templates.AgendaSegmentRef>;
export type SaveAsOrgTemplateOut = z.infer<typeof templates.operations.saveAsOrgTemplate.out>;

export async function getWorkflowOrchestration(projectId: string): Promise<WorkflowOrchestrationOut> {
  return apiRequest<WorkflowOrchestrationOut>(
    templates.operations.getWorkflowOrchestration.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "GET" },
  );
}

/**
 * 另存为组织模板（契约 `saveAsOrgTemplate`）。`projectId` 走路径参数，`name` 走请求体——
 * 与契约 `in` 形状一致（`in` 里的 `projectId` 由控制器从路径解析，请求体只携带 `name`，
 * 同 `blueprint.controller.ts` 里 `SAVE_AS_ORG_TEMPLATE_BODY_SCHEMA = in.omit({projectId:true})`
 * 的既有约定）。
 */
export async function saveAsOrgTemplate(projectId: string, name: string): Promise<SaveAsOrgTemplateOut> {
  return apiRequest<SaveAsOrgTemplateOut>(
    templates.operations.saveAsOrgTemplate.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "POST", body: { name } },
  );
}

/**
 * 后端真实信封原样回显——同 `tab-prep.tsx`/`workflow-screen.tsx` 里其它 `describeXError`
 * 的既有纪律：只把契约 `saveAsOrgTemplate.err` 里真有的码翻成人话，其余原样带
 * reasonCode/HTTP status，不臆造。两处调用方（`tab-prep.tsx` 的
 * `project-prep-save-template` / `workflow-screen.tsx` 的 `tpl-wf-saveorg`）共用这一份，
 * 不各自抄一遍——它们是同一个契约操作的同一组错误码，不是两件事。
 */
export function describeSaveAsOrgTemplateError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.reasonCode === "ROLE_INSUFFICIENT" || e.reasonCode === "NO_PROJECT_ROLE") {
      return "你在这个项目里没有另存为组织模板的权限";
    }
    if (e.reasonCode === "DEPENDENCY_UNAVAILABLE") {
      return "这个项目还没有工作流编排数据，没有可另存的内容";
    }
    return `${e.reasonCode ?? "无 reasonCode"}（HTTP ${e.status}）`;
  }
  if (e instanceof Error) return e.message;
  return "未知错误";
}
