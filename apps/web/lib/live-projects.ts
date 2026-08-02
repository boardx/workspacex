/**
 * F122 —— 真实 API 的类型化薄封装，供 `/project/live` 页面使用。
 *
 * 类型全部从 `@repo/contracts` 推导，不重新声明——同一份形状两处声明正是本仓
 * AGENTS.md 点名的事故模式（设计 token / 字号档位 / …）。
 */
import { project } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type ProjectListItem = z.infer<typeof project.ProjectListItem>;
export type ListProjectsOut = z.infer<typeof project.operations.listProjects.out>;
export type CreateProjectOut = z.infer<typeof project.operations.createProject.out>;

/**
 * `login` 已提到 `./auth.ts`（issue #355）——两个真实入口
 * （`(entry)/login`、`/project/live`）共用同一份实现，这里只做转发，
 * 不重新声明，避免和 F122 之前的做法一样再长出第二份。
 */
export { login, type LoginOut } from "./auth";

export async function listProjects(orgId: string): Promise<ListProjectsOut> {
  return apiRequest<ListProjectsOut>(project.operations.listProjects.path, {
    method: "GET",
    query: { orgId },
  });
}

/**
 * F353 —— 按 id 找一个项目的真实基本信息。
 *
 * ⚠ 契约里**有** `getProjectOverview`（`GET /projects/:projectId/overview`），但
 * `apps/api/src/interface/controllers/project.controller.ts` 只挂了 `create`/`list`
 * 两个方法——那条路由从未被控制器实现过（应用层 `get-project-overview.ts` 与
 * PG 仓库都在，唯独没有对应的 `@Get` 方法）。这是一个后端缺口，不是本次前端集成
 * 该顺手补的东西（issue #353：不新增路由）——已在 PR 描述里报告。
 *
 * 因此这里只能退而求其次：用已经真实挂了的 `listProjects` 复用两段列表，
 * 在 member/managed 里按 id 查——能拿到的字段就是 `ProjectListItem` 那五个
 * （id/name/kind/status/readOnlyReason），拿不到 `currentAgendaSegment`/`roleCounts`/
 * `backflow`/`blueprint` 这些只有 `getProjectOverview` 才有的东西。
 */
export async function findProject(orgId: string, projectId: string): Promise<ProjectListItem | null> {
  const out = await listProjects(orgId);
  return out.member.find((p) => p.id === projectId) ?? out.managed.find((p) => p.id === projectId) ?? null;
}

export const PROJECT_KIND_LABEL: Record<z.infer<typeof project.ProjectKind>, string> = {
  workshop: "工作坊",
  research_project: "研究项目",
  user_insight: "用户洞察",
};

export const PROJECT_STATUS_LABEL: Record<z.infer<typeof project.ProjectStatus>, string> = {
  active: "进行中",
  archived: "已归档",
};

export interface CreateProjectInput {
  readonly orgId: string;
  readonly name: string;
  readonly kind: z.infer<typeof project.ProjectKind>;
  readonly blueprintVersionId: string | null;
}

export async function createProject(input: CreateProjectInput): Promise<CreateProjectOut> {
  return apiRequest<CreateProjectOut>(project.operations.createProject.path, {
    method: "POST",
    body: input,
  });
}

export const PROJECT_KIND_OPTIONS = project.ProjectKind.options;
