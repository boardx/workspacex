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
 * 用已经真实挂了的 `listProjects` 复用两段列表，在 member/managed 里按 id 查——
 * 能拿到的字段就是 `ProjectListItem` 那五个（id/name/kind/status/readOnlyReason）。
 * `readOnlyReason` 是 `getProjectOverview` 不返回的字段（白名单四件里没有它），
 * 只需要粗粒度身份 + 只读原因的场景（工作台顶部项目头）继续用它。
 *
 * ⚠ 需要更完整的概览（`currentAgendaSegment`/`roleCounts`/`backflow`/`blueprint`）
 *   请用下面的 `getProjectOverview`——控制器的 `@Get` 路由其实早已由 F123 挂好
 *   （`project.controller.ts` 的 `overview()`），此前这里的注释误以为它没挂，
 *   已在 issue #362 更正。
 */
export async function findProject(orgId: string, projectId: string): Promise<ProjectListItem | null> {
  const out = await listProjects(orgId);
  return out.member.find((p) => p.id === projectId) ?? out.managed.find((p) => p.id === projectId) ?? null;
}

export type ProjectOverview = z.infer<typeof project.operations.getProjectOverview.out>;

/**
 * F362 —— 真实 `GET /projects/:projectId/overview`。不需要 `orgId`：契约
 * `getProjectOverview.in` 只收 `{ projectId }`，`orgId` 在服务端取自
 * `principal.orgId`（同 `advance`/`archive` 几条路由的形状）。
 */
export async function getProjectOverview(projectId: string): Promise<ProjectOverview> {
  return apiRequest<ProjectOverview>(
    project.operations.getProjectOverview.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "GET" },
  );
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
