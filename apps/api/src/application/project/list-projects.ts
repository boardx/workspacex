/**
 * UC-P2 `listProjects` —— **扁平数组**（Q-6① 2026-08-16 delta 裁 D，覆盖 2026-07-30 裁 B）。
 *
 * ⚠ 本用例此前返回两段（`member`/`managed`）。那条裁决已被人类在会话里直接推翻——
 *   见 `requirements/00-project/OPEN-QUESTIONS.md` 「🔁 2026-08-16 delta」与
 *   `contracts/project/usecases.md` UC-P2。**仓储层的两段查询没有变**（`listForActor`
 *   依然分别查 `member`/`managed`，理由仍是 `ports.ts` 上那条注释）——变的只是
 *   本用例把两段**按 id 合并去重**成一个数组，两种入列理由本身不删除，只是不再
 *   体现为响应体的顶层分段。
 *
 * ## `admin` 的管理范围没有团队收紧
 *
 * `identity` 束里 `team-only` 的收紧只管**内容读取**（`acl_bindings` / `VisibilityScope`），
 * 不管「谁能看见这个容器存在于列表里」——`usecases.md` 与 `domain.md` 都没有给
 * 「管理」这条入列理由写团队边界，`lead`/`admin` 的「管理」职责本身就是组织范围的（D-11 逐字
 * 「创建与管理项目」，没有团队限定词）。⚠ 这是本 feature 做的判断：契约与 usecases.md
 * 都没有回答要不要按团队收紧，已在 issue #103 报给签核人。
 *
 * ## 出现在列表里 ≠ 能读内容（D-18 边界）
 *
 * 这里返回的 `ProjectListRow` 除 `id/name/kind/status` 外只多带 `orgStatus`/`tags`
 * （前者供 `deriveReadOnlyReason` 判定只读原因），**没有任何内容摘要或计数**——
 * 与 `ProjectListItem` 的契约字段集合逐一对应，没有第七个字段可以夹带。
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
  readonly tags: readonly string[];
}

export type ListProjectsOutput = readonly ProjectListItemOutput[];

function toItem(row: ProjectListRow): ProjectListItemOutput {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    readOnlyReason: deriveReadOnlyReason({ projectStatus: row.status, orgStatus: row.orgStatus }),
    tags: row.tags,
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

  // 非成员：管理段按「没有管理权」处理，member 段仍然照查——一个没有组织身份的人
  // 理论上也不该能打到这条路由（Guard 会先挡），但用例层不假设 Guard 一定在场。
  const isManager = membership?.orgRole === "lead" || membership?.orgRole === "admin";

  const { member, managed } = await deps.repo.listForActor({
    orgId: input.orgId,
    actorId: input.actorId,
    isManager,
  });

  // 按 id 去重合并：同一个容器可能同时满足「持有项目角色」与「组织 lead/admin 管理」
  // 两种入列理由——2026-08-16 delta 明确要求响应体去重后只出现一次。
  const merged = new Map<string, ProjectListItemOutput>();
  for (const row of [...member, ...managed]) {
    if (!merged.has(row.id)) merged.set(row.id, toItem(row));
  }
  return [...merged.values()];
}
