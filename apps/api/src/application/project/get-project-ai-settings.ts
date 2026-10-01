/**
 * B2-S5 `getProjectAiSettings`（#4429）—— 读一个项目的「AI 权限」：哪些来源允许进入项目大脑。
 *
 * 读门与 `get-project-overview.ts` 同一条线：`authorize(read.published)` 对着项目对象本身——
 * 四种项目角色（含观察者）都带这个动作；非成员 ⇒ `NO_PROJECT_ROLE`，组织 admin / compliance
 * 越过项目层 ⇒ `ADMIN_NOT_SUPERUSER`（`decide()` 已分层，这里只透传）；判定服务不可用 ⇒
 * `AUTH_SERVICE_UNAVAILABLE`，不降级放行。
 *
 * ## 没有行 = 默认全部允许
 *
 * 侧表一个项目至多一行；从没设过的项目回 `allowedSources` 全集、`updatedAt` / `updatedBy` 为 null——
 * 「从没人设过」与「有人设成了全开」是两个事实，前端据 `updatedAt` 分辨，本用例不把它们捏成一个。
 */
import { project as C } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { ProjectError } from "./errors";
import type { ProjectAiSettingsRepository, ProjectAiSettingsRow, ProjectAiSourceKind } from "./project-ai-settings-ports";

/** 与 `get-project-overview.ts` 的 `OVERVIEW_READ_ACTION` 同一个动作字面量：问的是同一个问题。 */
export const AI_SETTINGS_READ_ACTION = "read.published";

/** 契约枚举的声明顺序 = 前端渲染顺序 = 落库顺序（单一来源，不在三处各排一遍）。 */
export const ALL_PROJECT_AI_SOURCES: readonly ProjectAiSourceKind[] = C.ProjectAiSourceKind.options;

export interface ProjectAiSettingsOutput {
  readonly projectId: string;
  readonly allowedSources: readonly ProjectAiSourceKind[];
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

export interface GetProjectAiSettingsDeps {
  readonly repo: ProjectAiSettingsRepository;
  readonly auth: AuthorizeDeps;
}

export interface GetProjectAiSettingsInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
}

/** 行 → 契约输出；`null` 行 ⇒ 默认全部允许。 */
export function toProjectAiSettingsOutput(projectId: string, row: ProjectAiSettingsRow | null): ProjectAiSettingsOutput {
  if (row === null) {
    return { projectId, allowedSources: ALL_PROJECT_AI_SOURCES, updatedAt: null, updatedBy: null };
  }
  return { projectId: row.projectId, allowedSources: row.allowedSources, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
}

export async function getProjectAiSettings(
  deps: GetProjectAiSettingsDeps,
  input: GetProjectAiSettingsInput,
): Promise<ProjectAiSettingsOutput> {
  let decision;
  try {
    decision = await authorize(deps.auth, {
      userId: input.userId,
      orgId: input.orgId,
      projectId: input.projectId,
      object: { kind: "project", id: input.projectId },
      action: AI_SETTINGS_READ_ACTION,
    });
  } catch {
    // 判定服务不可用一律拒绝，不得降级放行（同 `member-authorization.ts`）。
    throw new ProjectError("AUTH_SERVICE_UNAVAILABLE");
  }
  if (!decision.allowed) {
    // 分层透传（同 `get-project-overview.ts`）：其它 reasonCode 一律折叠为 NO_PROJECT_ROLE，
    // 以免 `getProjectAiSettings` 契约之外的码逃逸成 500。
    throw new ProjectError(decision.reasonCode === "ADMIN_NOT_SUPERUSER" ? "ADMIN_NOT_SUPERUSER" : "NO_PROJECT_ROLE");
  }

  const guarded = await deps.repo.find(input.orgId, input.projectId);
  const disclosed = discloseDecided(guarded, decision);
  // 上面已判 allowed，这一支理论不可达；留着是让「未经决策的载荷」在类型上就拿不出来。
  if (!isDisclosed(disclosed)) throw new ProjectError("NO_PROJECT_ROLE");
  return toProjectAiSettingsOutput(input.projectId, disclosed.payload);
}
