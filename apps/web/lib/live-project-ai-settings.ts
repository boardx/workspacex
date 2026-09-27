/**
 * 项目「AI 权限」（项目中枢 B2-S5，#4429）——契约 `project.operations.{getProjectAiSettings,
 * updateProjectAiSettings}` 的真实 API 薄封装（形状同 `live-project-members.ts`）。
 *
 * ⚠ `updateProjectAiSettings` 是整体替换：传入的 `allowedSources` 就是替换后的全集，空数组 = 全部关掉。
 */
import { project } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type ProjectAiSettings = z.infer<typeof project.ProjectAiSettings>;
export type ProjectAiSourceKind = z.infer<typeof project.ProjectAiSourceKind>;

function settingsPath(template: string, projectId: string): string {
  return template.replace(":projectId", encodeURIComponent(projectId));
}

export async function getProjectAiSettings(projectId: string): Promise<ProjectAiSettings> {
  return apiRequest<ProjectAiSettings>(
    settingsPath(project.operations.getProjectAiSettings.path, projectId),
    { method: "GET" },
  );
}

export async function updateProjectAiSettings(input: {
  projectId: string; allowedSources: ProjectAiSourceKind[];
}): Promise<ProjectAiSettings> {
  return apiRequest<ProjectAiSettings>(
    settingsPath(project.operations.updateProjectAiSettings.path, input.projectId),
    { method: "PUT", body: input },
  );
}
