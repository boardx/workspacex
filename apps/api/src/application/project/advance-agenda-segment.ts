/**
 * UC-P7 `advanceAgendaSegment` —— 推进 / 提前结束 / 跳过 / 合并，四种去向共用一条用例
 * （`usecases.md` UC-P7，契约 `packages/contracts/src/project.ts` `advanceAgendaSegment`）。
 *
 * ## 权限闭集判定：谁能做这四个动作，不是四个分别判断
 *
 * 四个动作词只对应**一个**权限动作 `agendaSegment.advance`——`usecases.md` 逐字「动作词在
 * **已实现的闭集**里」，I-P10 / I-P12 要求引用 `project-role-matrix.ts` 而不是另起判断。⇒
 * 本用例只调用一次 `authorize()`，`facilitator` 通过、`groupLead`/`member`/`observer` 一律
 * `PROJECT_ROLE_INSUFFICIENT`，无角色 `NO_PROJECT_ROLE`——四个动作共用同一次判定，
 * 不是「先查一次角色，再针对每个 action 各查一次」。
 *
 * ⚠ **动作字面量现在是 `agendaSegment.advance`，不再是旧的 `stage` 前缀动作词。**
 *   `project-role-matrix.ts` 曾经只声明旧前缀（F121 的败选名之一，见
 *   `scripts/lib/naming-single-source-patterns.mjs`，此处不重复拼出该字面量，避免又
 *   触发它自己的门控）；**F121**（PR #150，已合入 main）完成了「改名对齐」交付物，
 *   把矩阵里的字面量改成了 `agendaSegment.advance`。本文件现在**必须引用矩阵里实际
 *   存在的字面量**——继续引用旧前缀会让 `roleAllows()` 查一个矩阵里已不存在的动作，
 *   四种角色会全部落空（连 `facilitator` 也会被拒），这正是当初「提前对齐会引入新洞」
 *   那条纪律的反面：现在滞后没跟着改，同样会引入一个洞。
 *
 * ## SEGMENT_ALREADY_ACTIVE 由数据库产生，本用例只翻译它
 *
 * `usecases.md` 逐字：「由部分唯一索引产生（F118 建的），本 feature 只是把它翻译成失败码，
 * 不在应用层再判一次」。⇒ 这里**不**先 `SELECT` 工作坊内是否已有 `active` 再决定要不要激活
 * 下一条——那正是先查后写在并发下的空转门（同 `createProject` 幂等设计头注的同一条纪律）。
 * 仓储的 `advance()` 直接尝试激活下一条，`23505` 原样冒泡到这里，翻译成 `SEGMENT_ALREADY_ACTIVE`。
 *
 * ## `revokedTemporaryGrants` 恒为 0——这是一个已报的缺口，不是没实现
 *
 * 契约 `advanceAgendaSegment.out.revokedTemporaryGrants` 要求这个字段，且注释要求它是
 * 「四向失效」这条已签核副作用的**可断言载体**。但按环节授予的临时读权本身**还没有存储层**
 * ——那是 **F127**（`not_started`）的交付物，`grep` 全仓找不到任何 `temporary_grant` 相关的表。
 * 三条路都不通，同 `create-project.ts` 头注处理 `provenanceEventId` 缺口的方式一样，本函数
 * 不选边：
 *   · 编一个非零数字 = 谎报收回了不存在的东西；
 *   · 现在就去建临时提权的存储层 = 越权做了 F127 的交付物，且没有 F127 的验收面守着它；
 *   · 把字段留空 = 契约是 `.strict()` 的，响应体会当场校验失败。
 * ⇒ 恒返回 `0`，如实反映「今天没有任何临时提权可收回」，并将「这四种终结方式都必须触发收回」
 *   报给 F127 承接（本文件不重复计点，`usecases.md` 已注明验收归 F127）。
 */
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import type { OrgId } from "../../domain/org-id";
import {
  isTerminalState,
  requiresMergeTarget,
  targetStateFor,
  type AgendaSegmentAdvanceAction,
} from "../../domain/project/advance-segment-outcomes";
import type { ProvenanceWriter } from "../provenance/ports";
import { AgendaSegmentNotFoundError, MergeTargetRequiredError } from "./advance-agenda-segment-errors";
import { ProjectError } from "./errors";
import type { AdvanceAgendaSegmentResult, AgendaSegmentRepository } from "./ports";

/** 见文件头「动作字面量现在是 agendaSegment.advance」一节。引用矩阵，不新造常量值。 */
export const ADVANCE_AGENDA_SEGMENT_ACTION = "agendaSegment.advance" as const;

/** 今天没有临时提权的存储层可收回——见文件头。F127 落地后这个常量的用法需要重新审视。 */
const NO_TEMPORARY_GRANTS_TO_REVOKE = 0;

export interface AdvanceAgendaSegmentDeps {
  readonly auth: AuthorizeDeps;
  readonly segments: AgendaSegmentRepository;
  readonly provenance: ProvenanceWriter;
}

export interface AdvanceAgendaSegmentInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly workshopId: string;
  readonly segmentId: string;
  readonly action: AgendaSegmentAdvanceAction;
  readonly mergeIntoSegmentId: string | null;
}

export interface AdvanceAgendaSegmentOutput {
  readonly segment: AdvanceAgendaSegmentResult["segment"];
  readonly revokedTemporaryGrants: number;
  readonly provenanceEventId: string;
}

export async function advanceAgendaSegment(
  deps: AdvanceAgendaSegmentDeps,
  input: AdvanceAgendaSegmentInput,
): Promise<AdvanceAgendaSegmentOutput> {
  const { userId, orgId, workshopId, segmentId, action, mergeIntoSegmentId } = input;

  // 权限先于存在性判断——同 `bindToProjectStep` 的理由：一个在项目里没有角色的调用者
  // 不该能靠「环节存在与否」的两种不同拒绝，反推出这个工作坊里有没有这条环节。
  const decision = await authorize(deps.auth, {
    userId,
    orgId,
    projectId: workshopId,
    object: { kind: "project", id: workshopId },
    action: ADVANCE_AGENDA_SEGMENT_ACTION,
  });
  if (!decision.allowed) {
    throw new ProjectError(
      decision.reasonCode === "PROJECT_ROLE_INSUFFICIENT" ? "PROJECT_ROLE_INSUFFICIENT" : "NO_PROJECT_ROLE",
    );
  }

  if (requiresMergeTarget(action) && mergeIntoSegmentId === null) {
    // ⚠ 契约的 `err` 里没有这个码——见 `advance-agenda-segment-errors.ts` 头注。
    throw new MergeTargetRequiredError(`action "merge" requires mergeIntoSegmentId`);
  }

  const current = await deps.segments.findById(orgId, workshopId, segmentId);
  if (current === null) {
    throw new AgendaSegmentNotFoundError(`agenda segment ${segmentId} not found in workshop ${workshopId}`);
  }
  if (isTerminalState(current.state)) {
    throw new ProjectError("SEGMENT_TERMINAL");
  }

  let result: AdvanceAgendaSegmentResult;
  try {
    result = await deps.segments.advance({
      orgId,
      workshopId,
      segmentId,
      actorId: userId,
      nextState: targetStateFor(action),
      mergedInto: requiresMergeTarget(action) ? mergeIntoSegmentId : null,
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      // 并发的另一路先一步把下一条环节置为 active——见文件头「SEGMENT_ALREADY_ACTIVE」一节。
      throw new ProjectError("SEGMENT_ALREADY_ACTIVE");
    }
    throw e;
  }

  const provenanceEventId = await deps.provenance.append({
    orgId,
    type: "agenda-segment-state-changed",
    actorId: userId,
    target: { kind: "project", id: workshopId },
    detail: {
      segmentId: result.segment.id,
      action,
      state: result.segment.state,
      mergedInto: result.segment.mergedInto,
      activatedNextSegmentId: result.activatedNext?.id ?? null,
    },
  });

  return {
    segment: result.segment,
    revokedTemporaryGrants: NO_TEMPORARY_GRANTS_TO_REVOKE,
    provenanceEventId,
  };
}

/** PostgreSQL SQLSTATE 23505 = unique_violation（同 `pg-artifact-repository.ts` 等既有判据）。 */
function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "23505";
}
