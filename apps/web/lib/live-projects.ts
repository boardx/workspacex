/**
 * F122 —— 真实 API 的类型化薄封装，供 `/project/live` 页面使用。
 *
 * 类型全部从 `@repo/contracts` 推导，不重新声明——同一份形状两处声明正是本仓
 * AGENTS.md 点名的事故模式（设计 token / 字号档位 / …）。
 */
import { auth, project } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type ProjectListItem = z.infer<typeof project.ProjectListItem>;
export type ListProjectsOut = z.infer<typeof project.operations.listProjects.out>;
export type CreateProjectOut = z.infer<typeof project.operations.createProject.out>;
export type LoginOut = z.infer<typeof auth.operations.login.out>;

export async function login(email: string, password: string): Promise<LoginOut> {
  return apiRequest<LoginOut>(auth.operations.login.path, {
    method: "POST",
    body: { email, password },
    sessionToken: null, // 登录本身不带 token
  });
}

export async function listProjects(orgId: string): Promise<ListProjectsOut> {
  return apiRequest<ListProjectsOut>(project.operations.listProjects.path, {
    method: "GET",
    query: { orgId },
  });
}

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
