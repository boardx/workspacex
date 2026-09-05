/**
 * UC-17.8 B4.5 —— PM 设计工作台的真实 API 薄封装（契约 `designWorkbench`，
 * `packages/contracts/src/design-workbench.ts`）。
 *
 * 类型全部走 `z.infer`（`lint-contract-source` 要求）：这里**不重新声明**任何字段名或
 * 枚举值。`ProjectTemplate`/`DesignProject`/`DesignProjectChatTurn` 的唯一事实源是
 * 契约文件，本文件只是薄薄一层 `apiRequest` 封装，同 `live-inbox.ts`/`live-feedback.ts`
 * 的成例。
 *
 * ⚠ `deepenFeedback`（`POST /feedback/:feedbackId/deepen`）**不在本文件**——它已经在
 *   B4.4（`lib/live-feedback.ts`）里薄封装过一次，路由虽然挂在这份契约上，但调用方
 *   （收件箱屏）不是设计工作台屏，跟着"谁在用它"放，不重复导出第二份。
 *
 * ⚠ 契约没有单条 `getProject` 操作（见文件头【待确认点 1】：读操作对全组织放开，
 *   `listMyProjects` 是唯一的读入口）。`detail-screen.tsx` 需要单条项目时复用
 *   `listMyProjects()` 后在客户端按 `id` 查找——这不是绕开契约多造一个操作，而是
 *   契约本来就没打算为"查一条"单独开一条路由（同一批 items 反正都要能被组织内其他
 *   人看到）。真要给单条查询单独开销的场景（比如项目量级变大后分页），再加操作，
 *   不在这里"顺手"发明。
 */
import { designAiCollab, designWorkbench } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type ProjectTemplate = z.infer<typeof designWorkbench.ProjectTemplate>;
export type DesignProjectChatTurn = z.infer<typeof designWorkbench.DesignProjectChatTurn>;
export type DesignProject = z.infer<typeof designWorkbench.DesignProject>;
export type CreateProjectOut = z.infer<typeof designWorkbench.operations.createProject.out>;
export type ListMyProjectsOut = z.infer<typeof designWorkbench.operations.listMyProjects.out>;
export type UpdateProjectOut = z.infer<typeof designWorkbench.operations.updateProject.out>;
export type AppendProjectChatOut = z.infer<typeof designWorkbench.operations.appendProjectChat.out>;
/** B5.2：模型回复可写回的字段闭集——契约 `designAiCollab.DesignWritebackField` 派生，不手写。 */
export type DesignWritebackField = z.infer<typeof designAiCollab.DesignWritebackField>;
export type DeleteProjectOut = z.infer<typeof designWorkbench.operations.deleteProject.out>;
export type PushToInboxOut = z.infer<typeof designWorkbench.operations.pushToInbox.out>;
export type CreateDesignGithubIssueOut = z.infer<typeof designWorkbench.operations.createDesignGithubIssue.out>;
/** 建 issue 的草稿形状——与 `triageFeedback` 的 `issueDraft` 逐字相同，见契约头注。 */
export type DesignIssueDraft = z.infer<typeof designWorkbench.operations.createDesignGithubIssue.in>["draft"];

/** 首页三类模板入口的闭集顺序——同契约 `ProjectTemplate` 枚举顺序，供下拉框/网格复用。 */
export const PROJECT_TEMPLATE_OPTIONS = designWorkbench.ProjectTemplate.options;

/** 空状态引导语 / 固定回执——展示层文案，不落库（见契约文件头【待确认点 2】）。 */
export const DESIGN_WORKBENCH_CHAT_INTRO = designWorkbench.DESIGN_WORKBENCH_CHAT_INTRO;
export const DESIGN_WORKBENCH_CHAT_REPLY = designWorkbench.DESIGN_WORKBENCH_CHAT_REPLY;

export async function createProject(input: {
  readonly name: string;
  readonly template: ProjectTemplate;
  readonly problem?: string;
  readonly linkedFeedbackId?: string;
}): Promise<CreateProjectOut> {
  return apiRequest<CreateProjectOut>(designWorkbench.operations.createProject.path, {
    method: "POST",
    body: input,
  });
}

export async function listMyProjects(q?: string): Promise<ListMyProjectsOut> {
  return apiRequest<ListMyProjectsOut>(designWorkbench.operations.listMyProjects.path, {
    query: { q: q !== undefined && q.trim() !== "" ? q.trim() : undefined },
  });
}

export async function updateProject(
  projectId: string,
  patch: { readonly name?: string; readonly template?: ProjectTemplate; readonly problem?: string },
): Promise<UpdateProjectOut> {
  return apiRequest<UpdateProjectOut>(
    designWorkbench.operations.updateProject.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "PATCH", body: patch },
  );
}

export async function appendProjectChat(projectId: string, text: string): Promise<AppendProjectChatOut> {
  return apiRequest<AppendProjectChatOut>(
    designWorkbench.operations.appendProjectChat.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "POST", body: { text } },
  );
}

export async function deleteProject(projectId: string): Promise<DeleteProjectOut> {
  return apiRequest<DeleteProjectOut>(
    designWorkbench.operations.deleteProject.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "DELETE" },
  );
}

export async function pushToInbox(projectId: string, note?: string): Promise<PushToInboxOut> {
  return apiRequest<PushToInboxOut>(
    designWorkbench.operations.pushToInbox.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "POST", body: { note: note !== undefined && note.trim() !== "" ? note.trim() : undefined } },
  );
}

/**
 * 2026-09-05「转开发」——把一个已推送的设计方案变成一张 GitHub issue。
 * 不幂等：已经有 issue 时服务端回 409 `DESIGN_ISSUE_ALREADY_EXISTS`（见契约头注）。
 */
export async function createDesignGithubIssue(
  projectId: string,
  draft: DesignIssueDraft,
): Promise<CreateDesignGithubIssueOut> {
  return apiRequest<CreateDesignGithubIssueOut>(
    designWorkbench.operations.createDesignGithubIssue.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "POST", body: { draft } },
  );
}
