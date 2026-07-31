/**
 * UC-P2 `listProjects` —— **两段式返回**（Q-6① 裁 B，`usecases.md` UC-P2）。
 *
 * ## 两段怎么来的
 *
 * `member`：调用者在 `project_memberships` 里有行的容器（任意四种项目角色之一）。
 * `managed`：调用者组织角色是 `lead` 或 `admin` 时，该组织**全部**容器
 *   （U-4 已裁 A：`admin` 不能创建，但「管理」这条入列理由与「创建」无关——
 *   `admin` 的入列理由只剩「管理」，不含「我建的」，见 `domain.md` U-4 那条注释）。
 * ⚠ **两段不互斥**：同一个容器可能同时持有项目角色 `且` 是管理者，也可能只落在一段里
 *   ——这正是 `tests/project/list-projects-two-segments.test.ts` 要钉住的反证。
 *
 * ## `admin` 的 `managed` 段范围没有团队收紧
 *
 * `identity` 束里 `team-only` 的收紧只管**内容读取**（`acl_bindings` / `VisibilityScope`），
 * 不管「谁能看见这个容器存在于列表里」——`usecases.md` 与 `domain.md` 都没有给
 * `managed` 段写团队边界，`lead`/`admin` 的「管理」职责本身就是组织范围的（D-11 逐字
 * 「创建与管理项目」，没有团队限定词）。⚠ 这是本 feature 做的判断：契约与 usecases.md
 * 都没有回答「managed 段要不要按团队收紧」，已在 issue #103 报给签核人。
 *
 * ## 出现在 `managed` 里 ≠ 能读内容（D-18 边界）
 *
 * 这里返回的 `ProjectListRow` 除 `id/name/kind/status` 外只多带 `orgStatus`
 * （供 `deriveReadOnlyReason` 判定只读原因），**没有任何内容摘要或计数**——
 * 与 `ProjectListItem` 的契约字段集合逐一对应，没有第五个字段可以夹带。
 */
import { deriveReadOnlyReason } from "../../domain/project/readonly-reason";
import type { ProjectKind } from "../../domain/project/create-project-rules";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import { ProjectError } from "./errors";
import type { ProjectListRepository, ProjectListRow } from "./ports";

export interface ListProjectsDeps {
  /** ⚠ `ProjectListRepository`，不是 `ProjectRepository`——见 `ports.ts` 上那条注释：
   *  两个仓储各自的 `lint-permission-paths` 豁免只在各自文件里成立。 */
  readonly repo: ProjectListRepository;
  readonly identity: IdentityRepository;
}

export interface ListProjectsInput {
  readonly orgId: OrgId;
  readonly actorId: string;
}

export interface ProjectListItemOutput {
  readonly id: string;
  readonly name: string;
  readonly kind: ProjectKind;
  readonly status: "active" | "archived";
  readonly readOnlyReason: "archived" | "org-disabled" | null;
}

export interface ListProjectsOutput {
  readonly member: readonly ProjectListItemOutput[];
  readonly managed: readonly ProjectListItemOutput[];
}

function toItem(row: ProjectListRow): ProjectListItemOutput {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    readOnlyReason: deriveReadOnlyReason({ projectStatus: row.status, orgStatus: row.orgStatus }),
  };
}

export async function listProjects(
  deps: ListProjectsDeps,
  input: ListProjectsInput,
): Promise<ListProjectsOutput> {
  let membership: Awaited<ReturnType<IdentityRepository["findOrgMembership"]>>;
  try {
    membership = await deps.identity.findOrgMembership(input.actorId, input.orgId);
  } catch {
    // ⚠ 判定服务不可用**一律拒绝，不得降级放行**——与 `createProject` 同一条纪律
    //   （`AUTH_SERVICE_UNAVAILABLE` 是本操作契约里**唯一**的失败码）。
    throw new ProjectError("AUTH_SERVICE_UNAVAILABLE");
  }

  // 非成员：两段都按「没有管理权」处理，`member` 段仍然照查——一个没有组织身份的人
  // 理论上也不该能打到这条路由（Guard 会先挡），但用例层不假设 Guard 一定在场。
  const isManager = membership?.orgRole === "lead" || membership?.orgRole === "admin";

  const { member, managed } = await deps.repo.listForActor({
    orgId: input.orgId,
    actorId: input.actorId,
    isManager,
  });

  return {
    member: member.map(toItem),
    managed: managed.map(toItem),
  };
}
