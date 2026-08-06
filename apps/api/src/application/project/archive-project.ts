/**
 * UC-P4 `archiveProject` —— 两态之一（Q-5 裁 B），F124。
 *
 * ## 权限：复用 `canCreateProject`，不新造角色
 *
 * 契约 `archiveProject.err` 只有 `ORG_ROLE_INSUFFICIENT` 一个权限码，`usecases.md`
 * 没有再定义一套「谁能归档」——issue #104 的 user_visible_behavior 写的是
 * 「项目负责人把项目归档」，而本域里「负责人」对应的组织角色闭集判据
 * （`domain/project/create-project-rules.ts` 的 `canCreateProject`）已经存在。
 * ⚠ **该判据已于 2026-08-06 由人类裁决放宽为「`lead` 或 `admin`」（#608，覆盖 U-4 裁 A）**，
 * 而本文件是**复用**它 ⇒ 归档/解归档的可执行角色**随之扩大到 `admin`**。
 * 这是「复用而不是新造判据」这个选择的直接后果，在 #608 的 PR 正文里作为影响面显式列出；
 * 若签核人认为归档应当保持 `lead` 专属，正确的动作是在这里新增一个独立的
 * `canArchiveProject`，而不是把 `canCreateProject` 改回去。
 * ⚠ **复用本身是本 feature 的判断，不是裁决原文逐字规定**：
 * `usecases.md` UC-P4 没有单列一条「谁能归档」的权限表。选择复用而不是新增一个
 * `canArchiveProject`（内容会与 `canCreateProject` 完全相同）是因为「解归档权限
 * 同归档者，不新造角色」（U-2⑴ 裁决行逐字）已经确立了「归档链路不产生新角色」
 * 这条方向，复用与之一致；如果签核人认为归档应当有独立于创建的权限模型，
 * 这是需要回到契约层新增判据的事,已在 issue 里报告为判断而非既定事实。
 *
 * ## U-2⑵：有 `active` 议程环节时拒绝归档，失败码故意没有名字
 *
 * 见 `./errors.ts` 的 `ProjectArchiveBlockedByActiveSegmentError` 与
 * `packages/contracts/src/project.ts` 的 `KNOWN_CONTRACT_GAPS.P7`。本函数原样
 * 把仓储判定的 `active-segment-exists` 结果转成那个不带契约码的错误，不发明码。
 *
 * ## `provenanceEventId` 缺席，同 `createProject` 的 P3 先例
 *
 * 契约 `archiveProject.out` 要求 `provenanceEventId: z.string()`，而
 * `ProvenanceEventType` 里没有「项目已归档」这个类型（`KNOWN_CONTRACT_GAPS.P3`
 * 逐字点名「项目已归档」是四个缺席事件类型之一）。三条路都不通的论证与
 * `create-project.ts` 文件头完全相同：加枚举成员是修订已签核共享束、借用现成类型
 * 是往 append-only 审计流里写错误语义、编一个假 id 是「全绿但空转」。
 * ⇒ 本函数同样**少一个字段**，由 `tests/project/archive-four-consequences.test.ts`
 * 钉住这个已知缺口。
 */
import type { OrgId } from "../../domain/org-id";
import { canCreateProject } from "../../domain/project/create-project-rules";
import type { IdentityRepository } from "../identity/ports";
import { ProjectArchiveBlockedByActiveSegmentError, ProjectError } from "./errors";
import type { ProjectArchiveRepository } from "./ports";

export interface ArchiveProjectDeps {
  readonly repo: ProjectArchiveRepository;
  readonly identity: IdentityRepository;
}

export interface ArchiveProjectInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly projectId: string;
}

/** ⚠ 响应体没有 `provenanceEventId`——见文件头 P3 先例。 */
export interface ArchiveProjectOutput {
  readonly projectId: string;
  readonly status: "archived";
}

export async function archiveProject(
  deps: ArchiveProjectDeps,
  input: ArchiveProjectInput,
): Promise<ArchiveProjectOutput> {
  let orgRole: Awaited<ReturnType<IdentityRepository["findOrgMembership"]>>;
  try {
    orgRole = await deps.identity.findOrgMembership(input.actorId, input.orgId);
  } catch {
    // ⚠ 判定服务不可用**一律拒绝，不得降级放行**（同 `create-project.ts`）。
    throw new ProjectError("AUTH_SERVICE_UNAVAILABLE");
  }

  if (!canCreateProject(orgRole?.orgRole ?? null)) {
    throw new ProjectError("ORG_ROLE_INSUFFICIENT");
  }

  const outcome = await deps.repo.archive(input.orgId, input.projectId);
  switch (outcome.kind) {
    case "archived":
      return { projectId: outcome.projectId, status: "archived" };
    case "already-archived":
      throw new ProjectError("PROJECT_ARCHIVED");
    case "active-segment-exists":
      throw new ProjectArchiveBlockedByActiveSegmentError();
    case "not-found":
      // 契约没有 NOT_FOUND：同 `createProject` 里「非成员与非 lead 同码」的先例，
      // 不存在的容器与「你管不了这个容器」落在同一个码上，不额外暴露存在性。
      throw new ProjectError("ORG_ROLE_INSUFFICIENT");
  }
}
