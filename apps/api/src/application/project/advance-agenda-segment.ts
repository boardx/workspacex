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
 * ## `revokedTemporaryGrants`——F127 把它从恒 0 接上真实的收回
 *
 * 契约 `advanceAgendaSegment.out.revokedTemporaryGrants` 要求这个字段是「四向失效」这条
 * 已签核副作用的**可断言载体**。F05 交付了判定逻辑（`checkTemporaryGrantAccess` 在读侧
 * 首次观察到失效时收回），但故意没建存储层、也没有把收回接到这里——那是 F127
 * （`temporary-grant-ports.ts` 头部原话：「越权做了 F127 的交付物」）的交付物。
 * 本 feature（F127）把 `PgTemporaryGrantRepository`（`temporary_grants` 表，迁移
 * `20260801200000_f127_temporary_grants_table.sql`）接进来：状态机转移成功后
 * ——**四种去向落地后一律是终态**（advance/closeEarly/merge 落 `closed`，skip 落
 * `skipped`；本函数入口的 `isTerminalState` 检查已经保证转移前一定是 pending/active，
 * 所以转移后一定是终态，不需要对四种 action 分别判断要不要收回）——查出所有仍挂在
 * **这一条**环节上的活跃临时提权，逐条 `markRevoked` 并各写一条审计事件，返回真实数量。
 *
 * ⚠ 不查其它环节：只有 `findActiveBySegment(orgId, workshopId, segmentId)`
 *   命中的行会被收回——挂在同一工作坊里别的（仍在进行中的）环节上的临时提权不受影响，
 *   这正是反向反证 `temp-grant-active-while-segment-open.test.ts` 断言的那条。
 *
 * ⚠ 与 `checkTemporaryGrantAccess` 共用同一个 `markRevoked`：它是幂等的（`orgId` + `id`
 *   定位，`revoked_at IS NULL` 才生效），两条路径谁先到都不会重复计数或重复写审计
 *   （见 `temporary-grant-ports.ts` 的 `markRevoked` 文档）。
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
import type { TemporaryGrantRepository } from "../identity/temporary-grant-ports";
import { AgendaSegmentNotFoundError, MergeTargetRequiredError } from "./advance-agenda-segment-errors";
import { ProjectError } from "./errors";
import type { AdvanceAgendaSegmentResult, AgendaSegmentRepository } from "./ports";

/** 见文件头「动作字面量现在是 agendaSegment.advance」一节。引用矩阵，不新造常量值。 */
export const ADVANCE_AGENDA_SEGMENT_ACTION = "agendaSegment.advance" as const;

export interface AdvanceAgendaSegmentDeps {
  readonly auth: AuthorizeDeps;
  readonly segments: AgendaSegmentRepository;
  readonly provenance: ProvenanceWriter;
  /** F127：本次状态机变更要主动收回的临时提权仓储——见文件头「revokedTemporaryGrants」一节。 */
  readonly grants: TemporaryGrantRepository;
  /** F127：收回时间戳的来源，同 `check-temporary-grant-access.ts` 的 `clock` 依赖同型。 */
  readonly clock: { now(): string };
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

  // 见文件头「revokedTemporaryGrants」一节：转移后一定是终态，无需按 action 分支判断。
  const revokedTemporaryGrants = await revokeGrantsForTerminatedSegment(deps, {
    orgId,
    workshopId,
    segmentId: result.segment.id,
    actorId: userId,
  });

  return {
    segment: result.segment,
    revokedTemporaryGrants,
    provenanceEventId,
  };
}

/**
 * F127: 收回挂在这一条（刚终结的）环节上的全部活跃临时提权，逐条写审计，返回真实收回数。
 * 只查 `segmentId` 这一条——同工作坊里别的环节（仍 pending/active）上的临时提权不受影响。
 */
async function revokeGrantsForTerminatedSegment(
  deps: AdvanceAgendaSegmentDeps,
  args: { orgId: OrgId; workshopId: string; segmentId: string; actorId: string },
): Promise<number> {
  const { orgId, workshopId, segmentId, actorId } = args;
  const candidates = await deps.grants.findActiveBySegment(orgId, workshopId, segmentId);
  const revokedAt = deps.clock.now();
  let revoked = 0;
  for (const grant of candidates) {
    // `markRevoked` 幂等：与 `checkTemporaryGrantAccess` 的读侧收回共用同一个方法，
    // 谁先到都只生效一次——见 `temporary-grant-ports.ts` 的文档。
    const didRevoke = await deps.grants.markRevoked(orgId, grant.id, revokedAt, "agenda-segment-terminal");
    if (!didRevoke) continue;
    revoked += 1;
    await deps.provenance.append({
      orgId,
      type: "role-changed",
      actorId,
      target: { kind: "project", id: workshopId },
      detail: {
        op: "temp-grant-expired",
        granteeId: grant.granteeId,
        action: grant.scope.action,
        groupId: grant.scope.groupId,
        agendaSegmentId: segmentId,
        grantId: grant.id,
        revokedReason: "agenda-segment-terminal",
      },
    });
  }
  return revoked;
}

/** PostgreSQL SQLSTATE 23505 = unique_violation（同 `pg-artifact-repository.ts` 等既有判据）。 */
function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "23505";
}
