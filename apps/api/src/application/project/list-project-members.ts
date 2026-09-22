/**
 * UC-P9 `listProjectMembers` —— 成员名单的读端（#609，coord-main 2026-08-06 裁决，
 * ADR-023 contract-delta，待人类在束级 `design-signoff.md` 补签）。
 *
 * ## 这条补的是「够不着」，不是「坏了」
 *
 * 同束三个写成员的操作齐全（F125 已 passing），读端零个。`changeProjectRole` /
 * `removeProjectMember` 都要求一个 `userId`，而调用方无从得知这个项目里有哪些 `userId`
 * ——界面建不出来不是因为那三个端点坏了，是因为**够不着**。
 *
 * ## 权限：复用 `read.published`，不新造动作词
 *
 * 与 `get-project-overview.ts` 的 `OVERVIEW_READ_ACTION`、`list-agenda-segments.ts` 的
 * `LIST_AGENDA_SEGMENTS_ACTION` 是**同一个字面量**，各自声明各自的常量（不跨用例 import），
 * 理由同那两处文件头。#609 逐字裁：名单是 `getProjectOverview.out.roleCounts`（已经把四类
 * 角色的**人数**给了项目成员）的自然细化，从「有 3 个组员」到「这 3 个组员是谁」不构成新的
 * 可见性层级；**四种项目角色（含 `observer`）皆可读**——观察者被明确禁的是原始转写与私聊，
 * 不含姓名。
 *
 * ⇒ `PROJECT_ROLE_INSUFFICIENT` 在这条动作上不可达（四种角色都在
 *   `project-role-matrix.ts` 里持有 `read.published`），契约 `err` 里也没有它：
 *   任何拒绝一律折成 `NO_PROJECT_ROLE`，同 `listAgendaSegments` 的同型 catch-all。
 *
 * ## ⚠ 仅 `kind='workshop'`：非工作坊两类返回 `members: null`，**不是空数组**
 *
 * U-1 只裁了 `research_project` / `user_insight` 两类的数据形状，没有对应契约操作
 * （`KNOWN_CONTRACT_GAPS.P2`），#609 明确「那两类**不做**，前端显式显示『尚未建
 * （设计缺口）』，不假装空列表」。
 *
 * 空数组会把一个**设计缺口**渲染成一个**正常的空态**——两者在界面上长得一模一样，
 * 而「这一类容器的名单还没被设计」这件事会就此消失。所以这里的分支不是防御性代码，
 * 它是那条裁决在运行时唯一可观察的形式：非工作坊时**不去查名单**
 * （`listWorkshopMembers` 根本不被调用），返回 `null`。
 *
 * ## 「查不到这个容器」与「你没有角色」故意不可分辨
 *
 * 同 `get-project-overview.ts` 对 `snapshot === null` 的处理、
 * `permission-decision.ts` 文件头逐字：「`NO_PROJECT_ROLE` 与『没有这个项目』必须不可分辨」。
 *
 * ## 仓储故障不翻译成任何契约码
 *
 * `authorize()` 依赖的身份服务不可用 → `AUTH_SERVICE_UNAVAILABLE`（契约 `err` 里有它，
 * 且「判定服务不可用一律拒绝、不得降级放行」，同 `member-authorization.ts`）。
 * 但**名单仓储本身**的故障没有对应的契约码（本操作的 `err` 只有两个成员，
 * `getProjectOverview` 的 `DEPENDENCY_UNAVAILABLE` 不在其中）——所以这里**不捕获**它：
 * 让它按原样上抛成 500，而不是伪装成一个 `NO_PROJECT_ROLE`（把「库挂了」说成「你没权限」）
 * 或一个空名单（把故障说成空态）。发明一个未经签核的码同样不是本用例能做的动作。
 */
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import type { OrgId } from "../../domain/org-id";
import { ProjectError } from "./errors";
import type { ProjectMemberRosterEntry, ProjectMemberRosterRepository } from "./member-ports";

/** 见文件头「权限」一节——与 `get-project-overview.ts` 的 `OVERVIEW_READ_ACTION` 同一字面量。 */
export const LIST_PROJECT_MEMBERS_ACTION = "read.published" as const;

export interface ListProjectMembersDeps {
  readonly auth: AuthorizeDeps;
  readonly roster: ProjectMemberRosterRepository;
}

export interface ListProjectMembersInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
}

export interface ListProjectMembersOutput {
  /** ⚠ `null` = 该容器种类的名单尚未建（设计缺口）；`[]` = 这个工作坊一个成员都没有。 */
  readonly members: readonly ProjectMemberRosterEntry[] | null;
}

export async function listProjectMembers(
  deps: ListProjectMembersDeps,
  input: ListProjectMembersInput,
): Promise<ListProjectMembersOutput> {
  let decision;
  try {
    decision = await authorize(deps.auth, {
      userId: input.userId,
      orgId: input.orgId,
      projectId: input.projectId,
      object: { kind: "project", id: input.projectId },
      action: LIST_PROJECT_MEMBERS_ACTION,
    });
  } catch {
    // 判定服务不可用一律拒绝，不得降级放行——同 `member-authorization.ts`。
    throw new ProjectError("AUTH_SERVICE_UNAVAILABLE");
  }
  if (!decision.allowed) {
    // ⚠ 拒绝**不能**塌缩成空名单：空数组会让一次越权读静默通过，
    //   而「无权限」与「这个工作坊没有成员」是两件必须可分辨的事。
    throw new ProjectError("NO_PROJECT_ROLE");
  }

  const kind = await deps.roster.findProjectKind(input.orgId, input.projectId);
  // 见文件头：不存在的容器与「存在但你没有角色」从外部必须不可分辨。
  if (kind === null) throw new ProjectError("NO_PROJECT_ROLE");

  // ⚠ 见文件头：这条分支是 #609「仅 kind='workshop'」在运行时唯一可观察的形式。
  //   非工作坊两类**不去查名单**，返回 null（不是空数组）。
  if (kind !== "workshop") return { members: null };

  return { members: await deps.roster.listWorkshopMembers(input.orgId, input.projectId) };
}
