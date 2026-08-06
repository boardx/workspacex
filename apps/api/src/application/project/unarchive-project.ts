/**
 * UC-P4 `unarchiveProject` —— 归档可逆（U-2⑴ 裁 a），F124。
 *
 * ⚠ **不照抄 F22 组织冻结的不可逆形状**：组织冻结不可逆，代价由组织承担（罕见操作）；
 * 项目归档是日常动作，不可逆代价大得多（U-2⑴ 裁决行逐字）。⇒ 本操作存在，且
 * **权限同归档者，不新造角色**——复用 `canCreateProject`，理由与 `archive-project.ts`
 * 文件头相同。⚠ 该判据已于 2026-08-06 放宽为「`lead` 或 `admin`」（#608，覆盖 U-4 裁 A），
 * 本文件因复用而**连带**允许 `admin` 解归档；影响面见 `archive-project.ts` 头注同一段。
 *
 * ⚠ **无条件幂等**：项目已是 `active` 时再次解归档不报错，直接返回当前状态——
 * 同 `PgOrgLifecycleRepository.reactivate` 的先例，契约 `unarchiveProject.err`
 * 里没有「已经是 active」这个码，不发明一个。
 *
 * ⚠ `provenanceEventId` 缺席同 `archive-project.ts` 的 P3 先例——
 * 「已解归档」同样不在 `ProvenanceEventType` 里。
 */
import type { OrgId } from "../../domain/org-id";
import { canCreateProject } from "../../domain/project/create-project-rules";
import type { IdentityRepository } from "../identity/ports";
import { ProjectError } from "./errors";
import type { ProjectArchiveRepository } from "./ports";

export interface UnarchiveProjectDeps {
  readonly repo: ProjectArchiveRepository;
  readonly identity: IdentityRepository;
}

export interface UnarchiveProjectInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly projectId: string;
}

export interface UnarchiveProjectOutput {
  readonly projectId: string;
  readonly status: "active";
}

export async function unarchiveProject(
  deps: UnarchiveProjectDeps,
  input: UnarchiveProjectInput,
): Promise<UnarchiveProjectOutput> {
  let orgRole: Awaited<ReturnType<IdentityRepository["findOrgMembership"]>>;
  try {
    orgRole = await deps.identity.findOrgMembership(input.actorId, input.orgId);
  } catch {
    throw new ProjectError("AUTH_SERVICE_UNAVAILABLE");
  }

  if (!canCreateProject(orgRole?.orgRole ?? null)) {
    throw new ProjectError("ORG_ROLE_INSUFFICIENT");
  }

  const outcome = await deps.repo.unarchive(input.orgId, input.projectId);
  if (outcome.kind === "not-found") {
    throw new ProjectError("ORG_ROLE_INSUFFICIENT");
  }
  return { projectId: outcome.projectId, status: "active" };
}
