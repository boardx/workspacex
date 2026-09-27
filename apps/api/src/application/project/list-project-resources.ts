/**
 * 项目中枢 B2-S1（#4425）`listProjectResources` —— 一个项目的四类资源聚合视图。
 *
 * 判定同 `get-project-overview.ts`：`authorize(read.published)` 对着项目对象本身；拒绝按
 * `decision.reasonCode` 分层透传（ADMIN_NOT_SUPERUSER / NO_PROJECT_ROLE），判定服务不可用
 * ⇒ AUTH_SERVICE_UNAVAILABLE（不降级放行）。容器不存在与「没有角色」从外部不可分辨。
 *
 * 内容经 `discloseDecided()` 出来——仓储只交 `Guarded<T>`，忘了判定是类型错误不是疏漏。
 */
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import type { OrgId } from "../../domain/org-id";
import type { PermissionDecision } from "../../domain/identity/permission-decision";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { ProjectError } from "./errors";
import type { ProjectResourceKind, ProjectResourcePort, ProjectResourceRow } from "./project-resource-ports";

/** 与 `OVERVIEW_READ_ACTION` 同一个字面量，刻意同名：问的是同一个问题（你能不能看这个项目）。 */
export const PROJECT_RESOURCE_READ_ACTION = "read.published";

/** 四类全列，含 0——角标要的是「这一类有几个」，没有那一类不等于没有这个键。 */
export const PROJECT_RESOURCE_KINDS: readonly ProjectResourceKind[] = [
  "survey",
  "guided_research",
  "personal_transcription",
  "interview",
];

export interface ProjectResourceDeps {
  readonly auth: AuthorizeDeps;
  readonly resources: ProjectResourcePort;
}

export interface ProjectResourceViewer {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
}

export interface ListProjectResourcesOutput {
  readonly items: readonly ProjectResourceRow[];
  readonly counts: Record<ProjectResourceKind, number>;
}

/** 三个用例共用的项目成员门；抛 `ProjectError`，返回可用于 disclose 的决策。 */
export async function authorizeProjectResourceAccess(
  deps: ProjectResourceDeps,
  input: ProjectResourceViewer,
): Promise<PermissionDecision> {
  let decision: PermissionDecision;
  try {
    decision = await authorize(deps.auth, {
      userId: input.userId,
      orgId: input.orgId,
      projectId: input.projectId,
      object: { kind: "project", id: input.projectId },
      action: PROJECT_RESOURCE_READ_ACTION,
    });
  } catch {
    throw new ProjectError("AUTH_SERVICE_UNAVAILABLE");
  }
  if (!decision.allowed) {
    throw new ProjectError(
      decision.reasonCode === "ADMIN_NOT_SUPERUSER" ? "ADMIN_NOT_SUPERUSER" : "NO_PROJECT_ROLE",
    );
  }
  return decision;
}

export async function listProjectResources(
  deps: ProjectResourceDeps,
  input: ProjectResourceViewer,
): Promise<ListProjectResourcesOutput> {
  const decision = await authorizeProjectResourceAccess(deps, input);
  const guarded = await deps.resources.listProjectResources(input.orgId, input.projectId);
  const d = discloseDecided(guarded, decision);
  // 上面已经按 `allowed` 抛过，这一支理论不可达；到达时按无权限处理而不是放行。
  if (!isDisclosed(d)) throw new ProjectError("NO_PROJECT_ROLE");
  // 容器不存在 ⇒ 与「没有角色」同一个码（`permission-decision.ts` 文件头）。
  if (d.payload === null) throw new ProjectError("NO_PROJECT_ROLE");

  const items = [...d.payload].sort((a, b) =>
    a.linkedAt === b.linkedAt ? a.id.localeCompare(b.id) : a.linkedAt < b.linkedAt ? 1 : -1,
  );
  const counts = Object.fromEntries(PROJECT_RESOURCE_KINDS.map((k) => [k, 0])) as Record<ProjectResourceKind, number>;
  for (const it of items) counts[it.kind] += 1;
  return { items, counts };
}
