/**
 * B2-S5 `updateProjectAiSettings`（#4429）—— 整体替换一个项目的「AI 权限」来源集合。
 *
 * 写门复用 `authorizeManageMembers`（本项目引导师，或组织 lead / admin）——契约把这条操作的
 * 失败面列成与 `addProjectMember` 完全相同的四个码，就是这个判定的直接证据；不新造一个
 * 「能不能改 AI 权限」的判据（同 `update-project-tags.ts` 复用 `canCreateProject` 的理由）。
 *
 * ⚠ 整体替换语义：`allowedSources` 是替换后的全集，不是增量；空数组是合法值（全部关掉）。
 *   去重 + 按契约枚举顺序归一，落库与回显都是同一个规范形状。
 */
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import { ProjectError } from "./errors";
import { ALL_PROJECT_AI_SOURCES, toProjectAiSettingsOutput, type ProjectAiSettingsOutput } from "./get-project-ai-settings";
import { authorizeManageMembers } from "./member-authorization";
import type { ProjectAiSettingsRepository, ProjectAiSourceKind } from "./project-ai-settings-ports";

export interface UpdateProjectAiSettingsDeps {
  readonly repo: ProjectAiSettingsRepository;
  readonly identity: IdentityRepository;
}

export interface UpdateProjectAiSettingsInput {
  readonly actorId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly allowedSources: readonly ProjectAiSourceKind[];
}

/** 去重并按契约枚举顺序排列——落库 / 回显 / 前端渲染三处同一个顺序。 */
export function normalizeAiSources(sources: readonly ProjectAiSourceKind[]): ProjectAiSourceKind[] {
  const wanted = new Set(sources);
  return ALL_PROJECT_AI_SOURCES.filter((k) => wanted.has(k));
}

export async function updateProjectAiSettings(
  deps: UpdateProjectAiSettingsDeps,
  input: UpdateProjectAiSettingsInput,
): Promise<ProjectAiSettingsOutput> {
  await authorizeManageMembers(deps.identity, {
    actorId: input.actorId,
    orgId: input.orgId,
    projectId: input.projectId,
  });

  const outcome = await deps.repo.upsert({
    orgId: input.orgId,
    projectId: input.projectId,
    allowedSources: normalizeAiSources(input.allowedSources),
    updatedBy: input.actorId,
  });
  switch (outcome.kind) {
    case "upserted":
      return toProjectAiSettingsOutput(input.projectId, outcome.row);
    case "not-found":
      // 组织 lead / admin 走路径②时不查项目角色，容器不存在只能在这里发现；
      // 「没有这个项目」与「没有角色」必须不可分辨（`permission-decision.ts` 文件头）。
      throw new ProjectError("NO_PROJECT_ROLE");
  }
}
