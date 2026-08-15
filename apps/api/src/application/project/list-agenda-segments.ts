/**
 * UC-P6 `listAgendaSegments`（#853，契约 `packages/contracts/src/project.ts` 与
 * `createAgendaSegment` 同一次签核、同一张表）。
 *
 * ## 这条契约签了跟 `createAgendaSegment` 一样久，也是从来没有实现
 *
 * #627 补上了 `createAgendaSegment` 的 controller，但补完之后 #853 发现：前端建出来的
 * 环节初始态是 `pending`（`create-agenda-segment.ts`/仓储 `create()`），而
 * `getProjectOverview` 只回 `state='active'` 那一条——没有任何真实读路径能看见一条
 * `pending` 环节。用户能建，但建完之后那条环节在产品里**不可见**，「建了 → 刷新 →
 * 还在」这条闭环因此仍然做不出来。本文件补的是这条契约本身的实现缺口，不是设计缺口
 * （同 `create-agenda-segment.ts` 文件头那句，这里逐字成立第二次）。
 *
 * ## 权限：复用 `getProjectOverview` 的 `read.published`，不新造一个动作词
 *
 * `usecases.md` UC-P6 表格同样没有单独给 `listAgendaSegments` writes 一行「权限」。
 * `read.published` 是四种项目角色（含观察者）**唯一共同持有**的读动作
 * （`project-role-matrix.ts`：`facilitator`/`groupLead`/`member`/`observer` 都在自己的
 * 清单里列了它）——四种角色里没有一种会因为「角色不够」被拒，只有「压根没有项目角色」
 * 这一种拒绝在实践中可达（契约 `listAgendaSegments.err` 是
 * `["NO_PROJECT_ROLE","AUTH_SERVICE_UNAVAILABLE"]`：前者是本函数会抛的分层拒绝，
 * 后者是 `authorize()` 依赖的身份服务不可用时的透传，两者都在 `err` 里，
 * `PROJECT_ROLE_INSUFFICIENT` 不在其中——与它在这条动作上不可达是同一件事）。
 * 与 `get-project-overview.ts` 的
 * `OVERVIEW_READ_ACTION` 是**同一个字面量**，不是巧合：两者问的是同一个问题
 * 「你能不能看这个项目已发布的东西」，各自声明各自的常量（不跨束 import），
 * 理由同该文件头对 `list-backflow.ts` `BACKFLOW_READ_ACTION` 的处理。
 *
 * ## 不区分「工作坊不存在」与「没有环节」
 *
 * 契约 `out` 是 `z.array(AgendaSegment)`，没有一个「容器是否存在」的旁路字段——
 * `authorize()` 已经把「不存在的容器」与「存在但你没有角色」在外部渲染成同一个
 * `NO_PROJECT_ROLE`（同 `get-project-overview.ts` 对 `snapshot === null` 的处理），
 * 这里不再另开一次存在性判断，直接把仓储的空数组当作合法结果返回。
 */
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import type { OrgId } from "../../domain/org-id";
import { ProjectError } from "./errors";
import type { AgendaSegmentRepository, AgendaSegmentRow } from "./ports";

/** 见文件头「权限」一节——与 `get-project-overview.ts` 的 `OVERVIEW_READ_ACTION` 同一字面量。 */
export const LIST_AGENDA_SEGMENTS_ACTION = "read.published" as const;

export interface ListAgendaSegmentsDeps {
  readonly auth: AuthorizeDeps;
  readonly segments: AgendaSegmentRepository;
}

export interface ListAgendaSegmentsInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly workshopId: string;
}

export async function listAgendaSegments(
  deps: ListAgendaSegmentsDeps,
  input: ListAgendaSegmentsInput,
): Promise<readonly AgendaSegmentRow[]> {
  const decision = await authorize(deps.auth, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: input.workshopId,
    object: { kind: "project", id: input.workshopId },
    action: LIST_AGENDA_SEGMENTS_ACTION,
  });
  if (!decision.allowed) {
    // `read.published` 四个角色都持有，`PROJECT_ROLE_INSUFFICIENT` 在这条动作上不可达
    // （同 `LIST_AGENDA_SEGMENTS_ACTION` 注释）；契约 `err` 里也没有它，全部拒绝一律
    // 折成 `NO_PROJECT_ROLE`，与 `createAgendaSegment` 那条同型 catch-all 同一条纪律。
    throw new ProjectError("NO_PROJECT_ROLE");
  }

  return deps.segments.list(input.orgId, input.workshopId);
}
