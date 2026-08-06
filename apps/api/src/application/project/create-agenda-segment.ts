/**
 * UC-P6 `createAgendaSegment`（#627，`usecases.md` UC-P6，契约
 * `packages/contracts/src/project.ts` `createAgendaSegment`）。
 *
 * ## 这条契约签了一年多都没有实现——本文件补的是实现缺口，不是设计缺口
 *
 * `agenda_segments` 表（F118）、契约（`project.ts:502`）、design-signoff（束级
 * `project/design-signoff.md`，`status: confirmed`）都已经就位；全仓只是从来没有一个
 * controller 挂 `createAgendaSegment` 这条契约操作。缺口本身连 `apps/api/scripts/
 * seed-fullstack-smoke.ts` 都写着——那份种子脚本直连数据库插一行，注释原话「没有任何
 * 产品路径能造出一个议程环节」，是这条缺口最早的自我记录。见 issue #627。
 *
 * ## 权限：`agendaSegment.create` 是这次新加的动作词，见矩阵文件的类推说明
 *
 * `usecases.md` 的 UC-P6 表格**没有「权限」行**（对照 UC-P7 有）——已签核的用例文本
 * 对「谁能新建环节」本身沉默。`project-role-matrix.ts` 里 `agendaSegment.create` 那条
 * 注释已经写明：这是实现者按同一分组既有逻辑（`bindTemplate`：新建/绑定环节属于编排）
 * 做的类推，不是人类的裁决。如果人类核对后认为权限面该更宽，需要改的是矩阵那一行，
 * 不是这里——本文件只调用 `authorize()`，不重复判断。
 *
 * ## 不先查工作坊是否存在/是否归档
 *
 * 同 `advanceAgendaSegment`/`addProjectMember` 的纪律：存在性与归档判定都由数据库在
 * 写入的同一条语句里给出（复合外键 / F124 的 RESTRICTIVE INSERT 策略），仓储把驱动
 * 异常翻译成 `CreateAgendaSegmentOutcome` 的判别式，本函数只把判别式翻译成契约的
 * `err` 码，不再自己查一次库——先查后写在并发下是一扇空转的门（同一条纪律在
 * `create-project.ts`/`advance-agenda-segment.ts` 头注里各写过一遍）。
 *
 * ## `ordinal` 由调用方给，本函数不去重/不自动排序
 *
 * 契约 `in.ordinal` 是必填字段，UC-P6 表格与迁移文件都没有「同一工作坊内 ordinal 唯一」
 * 这条约束（没有唯一索引，见 F118 迁移）——本函数如实不发明这条约束，重复 ordinal
 * 传进来就原样落库。如果这是产品期望之外的空洞，属于 `usecases.md` 需要补的判据，
 * 不是本 feature 该在实现里悄悄堵上的。
 */
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import type { OrgId } from "../../domain/org-id";
import { ProjectError } from "./errors";
import type { AgendaSegmentRepository, AgendaSegmentRow } from "./ports";

/** 见文件头「权限」一节。矩阵里实际存在的字面量，不新造常量值。 */
export const CREATE_AGENDA_SEGMENT_ACTION = "agendaSegment.create" as const;

export interface CreateAgendaSegmentDeps {
  readonly auth: AuthorizeDeps;
  readonly segments: AgendaSegmentRepository;
}

export interface CreateAgendaSegmentInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly workshopId: string;
  readonly agendaSegmentDefinitionId: string | null;
  readonly ordinal: number;
  readonly title: string;
  readonly duration: number;
}

export async function createAgendaSegment(
  deps: CreateAgendaSegmentDeps,
  input: CreateAgendaSegmentInput,
): Promise<AgendaSegmentRow> {
  const decision = await authorize(deps.auth, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: input.workshopId,
    object: { kind: "project", id: input.workshopId },
    action: CREATE_AGENDA_SEGMENT_ACTION,
  });
  if (!decision.allowed) {
    throw new ProjectError(
      decision.reasonCode === "PROJECT_ROLE_INSUFFICIENT" ? "PROJECT_ROLE_INSUFFICIENT" : "NO_PROJECT_ROLE",
    );
  }

  const outcome = await deps.segments.create({
    orgId: input.orgId,
    workshopId: input.workshopId,
    agendaSegmentDefinitionId: input.agendaSegmentDefinitionId,
    ordinal: input.ordinal,
    title: input.title,
    duration: input.duration,
  });

  switch (outcome.kind) {
    case "not-found":
      // 同 `addProjectMember`/`archiveProject` 先例：不存在的容器与「你管不了这个
      // 容器」不应该靠两种不同的拒绝让调用者反推出工作坊存不存在——但这里权限已经
      // 先判过了（见上），到这里说明工作坊 id 本身是假的。契约的 `err` 里没有专门
      // 的「不存在」码，与 `NO_PROJECT_ROLE` 同码是刻意的：两者对调用者呈现的表面
      // 应当一致。
      throw new ProjectError("NO_PROJECT_ROLE");
    case "archived":
      throw new ProjectError("PROJECT_ARCHIVED");
    case "created":
      return outcome.row;
  }
}
