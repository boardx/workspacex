/**
 * 项目资源关联（项目中枢 B2-S2）——契约 `project.operations.{listProjectResources,
 * linkProjectResource, unlinkProjectResource}` 的真实 API 薄封装。
 *
 * 问卷 / 深度研究 / 个人转写三类各自的表没有 `project_id`，靠链接表挂到项目上；访谈
 * （`interview_sessions.project_id`）自带归属，只出现在 `list` 结果里，**不能**经这里挂 / 解挂
 * （契约 `ProjectLinkableResourceKind` 不含 `interview`，类型上就走不通）。
 *
 * 响应一律用契约 `out` schema 解析：后端与本层并行开发，形状漂移要在这一层立刻暴露，
 * 而不是让界面拿着半个对象渲染出空白。
 */
import { project } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type ProjectResourceKind = z.infer<typeof project.ProjectResourceKind>;
export type ProjectLinkableResourceKind = z.infer<typeof project.ProjectLinkableResourceKind>;
export type ProjectResourceItem = z.infer<typeof project.ProjectResourceItem>;
export type ListProjectResourcesOut = z.infer<typeof project.operations.listProjectResources.out>;
export type LinkProjectResourceOut = z.infer<typeof project.operations.linkProjectResource.out>;
export type UnlinkProjectResourceOut = z.infer<typeof project.operations.unlinkProjectResource.out>;

export { PROJECT_RESOURCE_KIND_LABEL_ZH } from "@repo/contracts/project";

function resourcePath(template: string, params: Record<string, string>): string {
  return Object.entries(params).reduce(
    (path, [key, value]) => path.replace(`:${key}`, encodeURIComponent(value)),
    template,
  );
}

export async function listProjectResources(projectId: string): Promise<ListProjectResourcesOut> {
  const op = project.operations.listProjectResources;
  const raw = await apiRequest<unknown>(resourcePath(op.path, { projectId }), { method: op.method });
  return op.out.parse(raw);
}

export async function linkProjectResource(input: {
  projectId: string; kind: ProjectLinkableResourceKind; resourceId: string;
}): Promise<LinkProjectResourceOut> {
  const op = project.operations.linkProjectResource;
  const body = op.in.parse(input);
  const raw = await apiRequest<unknown>(resourcePath(op.path, { projectId: input.projectId }), {
    method: op.method,
    body,
  });
  return op.out.parse(raw);
}

export async function unlinkProjectResource(input: {
  projectId: string; kind: ProjectLinkableResourceKind; resourceId: string;
}): Promise<UnlinkProjectResourceOut> {
  const op = project.operations.unlinkProjectResource;
  const body = op.in.parse(input);
  const raw = await apiRequest<unknown>(resourcePath(op.path, body), { method: op.method });
  return op.out.parse(raw);
}
