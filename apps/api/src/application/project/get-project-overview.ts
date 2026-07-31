/**
 * UC-P3 `getProjectOverview` —— 概览**白名单四件**（Q-6② 裁），三态可区分
 * （空态 / 依赖失败 / 分层无权限，`usecases.md` UC-P3 + uc-00-2 V9）。
 *
 * ## 白名单是封闭的，这里是它唯一的组装点
 *
 * 当前议程环节 · 四类项目角色人数 · 回流列表 · 蓝本名与版本——**只有这四件**。
 * 加第五件是修订已签核契约，不是本函数能做的判断（契约文件头逐字）。
 *
 * ## 三态怎么可区分
 *
 *   空态       —— 正常返回，字段是空/零值（`backflow: []`、`roleCounts` 四个 0、
 *                 `currentAgendaSegment: null`），**不抛错**。
 *   依赖失败   —— `DEPENDENCY_UNAVAILABLE`，任何一次仓储 / 绑定读取失败都映射到它，
 *                 与空态在类型上就不同（一个是返回值，一个是抛出），前端据此渲染
 *                 「可解释错误 + 重试」而不是把它画成一个空列表。
 *   分层无权限 —— `authorize()` 已经把「组织层挡的」（`ADMIN_NOT_SUPERUSER`）与
 *                 「项目层挡的」（`NO_PROJECT_ROLE`）分成两个不同的 reasonCode
 *                 （`domain/identity/permission-decision.ts` 的 `decide()`），
 *                 本函数只是把这个既有区分透传出去，不塌缩成一个 403。
 *
 * ## 为什么回流列表**复用** `listBackflow`，不重新查询
 *
 * I-P24 已经把回流列表的路由/字段/徽标/空态/失败码定死并 passing（phase-00 F06）。
 * 本 feature 只做它的项目侧投影：调 `listBackflow`，不重写 `bindings.listForProject`
 * 那条查询，也不重新判一遍权限——`listBackflow` 自己会用同一个 `read.published`
 * 动作再判一次，与本函数开头那次判断在同一个决策上应当一致（见下方注释）。
 *
 * ## 为什么本函数**自己也调一次 `authorize()`**，而不是只靠 `listBackflow` 的判断
 *
 * `listBackflow` 的失败面里只有 `NO_PROJECT_ROLE`（`binding-errors.ts` 的
 * `NoProjectRoleError` 把 `ADMIN_NOT_SUPERUSER` 与普通无角色**塌缩成同一个错误类**）。
 * `getProjectOverview.err` 却把两者列成两个不同的码——契约需要的「分层」信息只有
 * 直接读 `decision.reasonCode` 才拿得到，`listBackflow` 的错误类型已经把它丢了。
 *
 * ## 蓝本字段为什么恒为 `null`
 *
 * `createProject` 落库时**没有任何一列存得下 `blueprintVersionId`**
 * （`infrastructure/project/pg-project-repository.ts` 文件尾的注释、
 * 契约 `KNOWN_CONTRACT_GAPS.P4`/`P9`）——蓝本表本身要等 F23。
 * 本函数不新造一列去补这个洞：那会越过 F23 与 I-P33（`projects` 封闭列集）两条边。
 */
import { NoProjectRoleError } from "../artifact/binding-errors";
import type { BackflowEntryRecord, BindingDeps } from "../artifact/binding-ports";
import { listBackflow } from "../artifact/list-backflow";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import type { OrgId } from "../../domain/org-id";
import type { ProjectKind } from "../../domain/project/create-project-rules";
import { ProjectError } from "./errors";
import type {
  OverviewAgendaSegment,
  OverviewRoleCounts,
  ProjectOverviewRepository,
} from "./ports";

/**
 * 与 `list-backflow.ts` 的 `BACKFLOW_READ_ACTION` 是**同一个动作字面量**，不是巧合：
 * 概览与回流列表问的是同一个问题——「你能不能看这个项目已发布的东西」。
 * 两处各自 import 各自的常量而不是共享一个符号，理由同 `project.ts` 对
 * `STEP_GATE_CODES` 的处理：这里要的是「同名是刻意的」的证明，不是跨束依赖。
 */
export const OVERVIEW_READ_ACTION = "read.published";

export interface GetProjectOverviewInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
}

export interface GetProjectOverviewDeps {
  readonly repo: ProjectOverviewRepository;
  readonly auth: AuthorizeDeps;
  /** 复用 `listBackflow`，见文件头。 */
  readonly binding: BindingDeps;
}

export interface GetProjectOverviewOutput {
  readonly projectId: string;
  readonly name: string;
  readonly kind: ProjectKind;
  readonly status: "active" | "archived";
  readonly currentAgendaSegment: OverviewAgendaSegment | null;
  readonly roleCounts: OverviewRoleCounts | null;
  readonly backflow: readonly BackflowEntryRecord[];
  readonly blueprint: { readonly name: string; readonly version: number } | null;
}

export async function getProjectOverview(
  deps: GetProjectOverviewDeps,
  input: GetProjectOverviewInput,
): Promise<GetProjectOverviewOutput> {
  const decision = await authorize(deps.auth, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: input.projectId,
    object: { kind: "project", id: input.projectId },
    action: OVERVIEW_READ_ACTION,
  });
  if (!decision.allowed) {
    // 分层：`decide()` 已经把「组织层的人越过项目层」（ADMIN_NOT_SUPERUSER）与
    // 「压根没有项目角色」（NO_PROJECT_ROLE）判成两个不同的 reasonCode——这里只是
    // 透传，不是本函数在发明区分。任何其它 reasonCode（理论上不可达：本操作没有
    // 团队可见性范围绑定，`scopePassed` 恒真）一律按 NO_PROJECT_ROLE 处理，而不是
    // 让一个契约没声明的码逃逸出去变成 500。
    throw new ProjectError(
      decision.reasonCode === "ADMIN_NOT_SUPERUSER" ? "ADMIN_NOT_SUPERUSER" : "NO_PROJECT_ROLE",
    );
  }

  let snapshot;
  try {
    snapshot = await deps.repo.getProjectSnapshot(input.orgId, input.projectId);
  } catch {
    throw new ProjectError("DEPENDENCY_UNAVAILABLE");
  }
  if (snapshot === null) {
    // 授权判定看的是成员关系，不是「这个项目是否存在」——一个不存在的容器与一个存在
    // 但调用者没有角色的容器,从外部必须不可分辨（`permission-decision.ts` 文件头逐字：
    // 「`NO_PROJECT_ROLE` 与『没有这个项目』必须不可分辨」）。这里复用同一个码。
    throw new ProjectError("NO_PROJECT_ROLE");
  }

  let currentAgendaSegment: OverviewAgendaSegment | null = null;
  let roleCounts: OverviewRoleCounts | null = null;
  if (snapshot.kind === "workshop") {
    try {
      [currentAgendaSegment, roleCounts] = await Promise.all([
        deps.repo.getCurrentAgendaSegment(input.orgId, input.projectId),
        deps.repo.getWorkshopRoleCounts(input.orgId, input.projectId),
      ]);
    } catch {
      throw new ProjectError("DEPENDENCY_UNAVAILABLE");
    }
  }
  // 非工作坊两类：两个字段恒为 null——「四种项目角色不适用」是人类 2026-07-30 的收窄
  // 裁决，不是本函数没查到数据（契约 `getProjectOverview.out` 逐字同一句话）。

  let backflow: BackflowEntryRecord[];
  try {
    backflow = await listBackflow(deps.binding, {
      userId: input.userId,
      orgId: input.orgId,
      projectId: input.projectId,
    });
  } catch (e) {
    if (e instanceof NoProjectRoleError) {
      // 本函数开头已经用同一个动作/同一个对象判过一次权限——这一支在实践中不可达；
      // 达到时优先把它当成一次真实的权限缺口报出来，而不是悄悄吞成依赖失败。
      throw new ProjectError("NO_PROJECT_ROLE");
    }
    throw new ProjectError("DEPENDENCY_UNAVAILABLE");
  }

  return {
    projectId: input.projectId,
    name: snapshot.name,
    kind: snapshot.kind,
    status: snapshot.status,
    currentAgendaSegment,
    roleCounts,
    backflow,
    // KNOWN_CONTRACT_GAPS.P4 / P9：createProject 落库时没有任何一列存得下
    // blueprintVersionId，本函数不新造一列去补——见文件头。
    blueprint: null,
  };
}
