/**
 * Phase 20 EV04 —— 门状态回写与读取（契约束 `work-eval` UC-5 / UC-6；I-2 / I-9 / I-10；R5 / E9 / A4）。
 *
 * - 回写：只接受门脚本产出的 `WorkGateStatus` 整体；仅平台运营（鉴权先于任何仓储调用，E9）；
 *   `stableId` 须等于目录行、`subjectVersionDigest` 须对应该 Skill 的某个版本；按版本一行，旧版本记录保留。
 * - 读取：本组织成员；当前版本无记录 → 六门 `not_evaluated`（新版本导入后即如此，A4）；
 *   响应不含报告路径/夹具/grader 细节（R5）。
 */
import {
  PHASE1_GATES,
  type WorkGateStatus,
  type WorkGateView,
} from "@repo/contracts/work-eval";
import type { IdentityRepository } from "../identity/ports";
import type { OrgId } from "../../domain/org-id";

export const WORK_GATE_STATUS_REPOSITORY = Symbol("WorkGateStatusRepository");

/** 契约 `WorkGateView` 的形状，但 skillVersionId 为本仓文本 id（见 work-skill-catalog.controller 注释）。 */
export type GateView = Omit<WorkGateView, "skillVersionId"> & { readonly skillVersionId: string };

export interface GateStatusSnapshot {
  readonly channel: "candidate" | "verified" | "deprecated";
  readonly evalSuiteId: string | null;
  readonly currentDigest: string; // sha256:<hex>
  readonly version: { readonly id: string; readonly semanticLabel: string; readonly digest: string };
  readonly record: WorkGateStatus | null;
  /** 该 Skill 是否有「别的版本」的门状态记录（E4：新版本导入后旧版本仍有记录 → 当前版本 stale）。 */
  readonly otherVersionHasRecord: boolean;
}

export type GateWriteOutcome =
  | { readonly kind: "written" | "replayed"; readonly versionId: string }
  | { readonly kind: "not-found" | "stable-id-mismatch" | "digest-mismatch" | "idempotency-conflict" };

export interface WorkGateStatusRepository {
  /** 同一事务：幂等查重 → 锁目录行 → 校验 stableId/digest → upsert 版本记录 + 追加回写事件。 */
  writeBack(input: {
    readonly orgId: OrgId;
    readonly actorId: string;
    readonly skillId: string;
    readonly status: WorkGateStatus;
    readonly idempotencyKey: string;
    readonly requestDigest: string;
  }): Promise<GateWriteOutcome>;
  /** versionId 缺省 = 当前版本；skill 不存在 / 版本不属于该 skill → null。 */
  read(orgId: OrgId, skillId: string, versionId?: string): Promise<GateStatusSnapshot | null>;
}

export interface WorkGateStatusDeps {
  readonly identities: IdentityRepository;
  readonly gateStatus: WorkGateStatusRepository;
}

export class WorkGateSkillNotFoundError extends Error {}
export class WorkGatePlatformAdminRequiredError extends Error {}

/**
 * I-10 官方平台组织目录的注入口（生产 = `PLATFORM_ORG_ID`，见 kernel.module）。
 * 以 DI 提供而非读环境变量——授权判定路径上不允许存在环境开关；测试对该 provider 打桩。
 */
export const WORK_GATE_OFFICIAL_ORG = Symbol("WorkGateOfficialOrg");
export interface WorkGateOfficialOrg {
  orgId(): OrgId;
}

/**
 * I-10 / E9 回写授权规则的唯一实现：仅平台运营、且仅官方平台组织目录。
 * 控制器在校验请求体之前调用它（E9：鉴权先于校验），`writeBackWorkGateStatus` 内再调用同一函数兜底。
 */
export function assertGateWriter(input: { readonly isPlatformOperator: boolean; readonly orgId: OrgId; readonly officialOrgId: OrgId }): void {
  if (!input.isPlatformOperator || input.orgId !== input.officialOrgId) throw new WorkGatePlatformAdminRequiredError();
}
export class WorkGateDigestMismatchError extends Error {}
export class WorkGateStableIdMismatchError extends Error {}
export class WorkGateIdempotencyConflictError extends Error {}

/** 纯函数：快照 → 读视图。 */
export function toGateView(snapshot: GateStatusSnapshot, isPlatformOperator: boolean): GateView {
  const record = snapshot.record;
  const gates = PHASE1_GATES.map((gate) => {
    const hit = record?.gates.find((g) => g.gate === gate);
    return hit
      ? { gate, state: hit.outcome, reasonCode: hit.reasonCode, reason: hit.reason }
      : { gate, state: "not_evaluated" as const, reasonCode: null, reason: null };
  });
  const g5 = gates.find((g) => g.gate === "G5")!;
  const g5Pass = g5.state === "pass";
  const canMarkVerified = isPlatformOperator && g5Pass && snapshot.channel === "candidate";
  return {
    skillVersionId: snapshot.version.id,
    semanticLabel: snapshot.version.semanticLabel,
    evalSuiteId: snapshot.evalSuiteId,
    gates,
    subjectPassed: record?.subjectPassed ?? null,
    baselinePassed: record?.baselinePassed ?? null,
    deterministicTotal: record?.deterministicTotal ?? null,
    decidedAt: record?.decidedAt ?? null,
    // V16 / E4：所示版本不是当前版本，或当前版本尚无记录而更早版本有记录 → 「当前版本尚未重评」。
    stale: snapshot.version.digest !== snapshot.currentDigest || (record === null && snapshot.otherVersionHasRecord),
    canMarkVerified,
    markVerifiedBlockedReason: g5Pass ? null : g5.reasonCode,
  };
}

export async function writeBackWorkGateStatus(
  deps: WorkGateStatusDeps,
  input: {
    readonly actorId: string;
    readonly orgId: OrgId;
    readonly isPlatformOperator: boolean;
    /** I-10：回写只落官方平台组织目录。 */
    readonly officialOrgId: OrgId;
    readonly skillId: string;
    readonly status: WorkGateStatus;
    readonly idempotencyKey: string;
    readonly requestDigest: string;
  },
): Promise<GateView> {
  assertGateWriter(input);
  const outcome = await deps.gateStatus.writeBack({
    orgId: input.orgId,
    actorId: input.actorId,
    skillId: input.skillId,
    status: input.status,
    idempotencyKey: input.idempotencyKey,
    requestDigest: input.requestDigest,
  });
  switch (outcome.kind) {
    case "not-found":
      throw new WorkGateSkillNotFoundError();
    case "stable-id-mismatch":
      throw new WorkGateStableIdMismatchError();
    case "digest-mismatch":
      throw new WorkGateDigestMismatchError();
    case "idempotency-conflict":
      throw new WorkGateIdempotencyConflictError();
    case "written":
    case "replayed": {
      const snapshot = await deps.gateStatus.read(input.orgId, input.skillId, outcome.versionId);
      if (!snapshot) throw new WorkGateSkillNotFoundError();
      return toGateView(snapshot, true);
    }
  }
}

export async function getWorkGateStatus(
  deps: WorkGateStatusDeps,
  input: {
    readonly actorId: string;
    readonly orgId: OrgId;
    readonly isPlatformOperator: boolean;
    readonly skillId: string;
    readonly versionId?: string;
  },
): Promise<GateView> {
  if (!(await deps.identities.findOrgMembership(input.actorId, input.orgId))) throw new WorkGateSkillNotFoundError();
  const snapshot = await deps.gateStatus.read(input.orgId, input.skillId, input.versionId);
  if (!snapshot) throw new WorkGateSkillNotFoundError();
  return toGateView(snapshot, input.isPlatformOperator);
}
