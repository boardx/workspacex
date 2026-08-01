/**
 * F75 — 声纹销毁用例：`destroyVoiceprintsOnAssignmentComplete` / `sweepVoiceprints`。
 *
 * 两条用例、同一套副作用顺序：① 物理删除 embedding → ② 级联失效引用它的派生物 →
 * ③ 写一条销毁审计事件。顺序是契约的一部分——I-16 要求「不存在以已销毁 embedding 为
 * 输入、仍标记有效的派生物」，所以级联失效必须发生在（或至少不晚于）物理删除生效之后，
 * 而不是颠倒过来先失效缓存、再发现向量其实还在。
 *
 * ⚠ **两步都不是原子的**（doubles 也没有跨 store 的事务）：若删除向量成功、级联失效失败，
 *   函数仍然整体返回 `CASCADE_INVALIDATION_FAILED`——**不把这次调用报成功**（I-11/I-13/
 *   I-16/I-34 那条"部分成功一律不得报成功"的通用纪律），但已经物理删除的向量不会被这次
 *   失败复原。这是应用层已知的限制，留给真正接入 Postgres/对象存储时用同一份事务或
 *   补偿动作收口，本 feature 不在这里假装能做到跨存储原子性。
 */
import type { RecordingErrorCode } from "../../domain/recording/voiceprint-destruction";
import {
  checkDestroyOnAssignmentComplete,
  deriveInvalidationTargets,
  isSweepEligible,
} from "../../domain/recording/voiceprint-destruction";
import type {
  ChannelAssignmentInspector,
  DerivedRepresentationStore,
  ProvenanceLog,
  SessionInspector,
  VoiceprintPolicyProvider,
  VoiceprintStore,
} from "./voiceprint-destruction-ports";

export type Fail = { readonly ok: false; readonly reason: RecordingErrorCode };
export type Ok<T> = { readonly ok: true } & T;
export type Result<T> = Ok<T> | Fail;

const fail = (reason: RecordingErrorCode): Fail => ({ ok: false, reason });

export interface VoiceprintDestructionDeps {
  readonly channels: ChannelAssignmentInspector;
  readonly embeddings: VoiceprintStore;
  readonly derived: DerivedRepresentationStore;
  readonly provenance: ProvenanceLog;
  readonly sessions: SessionInspector;
  readonly policy: VoiceprintPolicyProvider;
}

/** 一次「删向量 → 失效级联 → 写审计」的共享步骤，两条用例都走它，顺序不许各写一份。 */
async function destroyAndCascade(
  deps: VoiceprintDestructionDeps,
  sessionId: string,
  reason: "assigned" | "fallback-d7",
  actor: string,
  at: string,
): Promise<Result<{ readonly destroyedCount: number; readonly auditEventId: string }>> {
  const embeddings = await deps.embeddings.listBySession(sessionId);
  const embeddingIds = embeddings.map((e) => e.embeddingId);

  // 没有活的 embedding 也走完整流程（幂等）：可能是重复调用，或者本场从未产生过声纹特征。
  const targets = await deps.derived.listReferencing(embeddingIds);
  const toInvalidate = deriveInvalidationTargets(targets, embeddingIds);

  try {
    await deps.embeddings.deleteAll(embeddingIds);
  } catch {
    return fail("DESTROY_PARTIAL_FAILURE");
  }

  try {
    await deps.derived.invalidate(toInvalidate, at);
  } catch {
    return fail("CASCADE_INVALIDATION_FAILED");
  }

  const auditEventId = await deps.provenance.recordVoiceprintDestroyed({
    sessionId,
    reason,
    actor,
    at,
    destroyedEmbeddingIds: embeddingIds,
  });

  return { ok: true, destroyedCount: embeddingIds.length, auditEventId };
}

export interface DestroyOnAssignmentCompleteInput {
  readonly sessionId: string;
  readonly actor: string;
  readonly at: string;
}

export interface DestroyOnAssignmentCompleteOutput {
  readonly destroyedCount: number;
  readonly auditEventId: string;
}

/**
 * `destroyVoiceprints`（trigger=`assignment-completed`）—— 指派完成即销毁本场声纹 embedding。
 * 指派未完成 ⇒ `ASSIGNMENT_NOT_COMPLETE`，绝不提前销毁。
 */
export async function destroyVoiceprintsOnAssignmentComplete(
  deps: VoiceprintDestructionDeps,
  input: DestroyOnAssignmentCompleteInput,
): Promise<Result<DestroyOnAssignmentCompleteOutput>> {
  const channels = await deps.channels.channelsOf(input.sessionId);
  const check = checkDestroyOnAssignmentComplete({ channels });
  if (!check.ok) return fail(check.reason);

  return destroyAndCascade(deps, input.sessionId, "assigned", input.actor, input.at);
}

export interface SweepVoiceprintsInput {
  readonly asOf: string;
  readonly actor: string;
}

export interface SweepVoiceprintsOutput {
  readonly sessions: readonly {
    readonly sessionId: string;
    readonly destroyedCount: number;
    readonly auditEventId: string;
  }[];
}

/**
 * `sweepVoiceprints` —— 兜底销毁（本场结束后第 7 天，**无条件**，不看指派是否完成）。
 *
 * 天数来自 `VoiceprintPolicyProvider`，不在本文件里出现字面量（见 domain 文件头的天数纪律）。
 * 未配置兜底天数 ⇒ 拒绝整批扫描——不得假设一个隐含默认值去决定"到底该不该销毁"这种
 * 不可逆动作（同 `RETENTION_POLICY_MISSING` 的纪律，只是这里复用 `DESTROY_PARTIAL_FAILURE`：
 * 契约里声纹销毁没有单独的"策略缺失"码，缺策略等同于"这一批一个都不能销毁"）。
 *
 * ⚠ 逐场次处理，**任一场次失败就整批失败**（不返回"部分成功"的场次列表）——
 *   同一条"部分成功一律不得报成功"纪律应用到批处理粒度。
 */
export async function sweepVoiceprints(
  deps: VoiceprintDestructionDeps,
  input: SweepVoiceprintsInput,
): Promise<Result<SweepVoiceprintsOutput>> {
  const fallbackDays = await deps.policy.fallbackDestroyDays();
  if (fallbackDays === null) return fail("DESTROY_PARTIAL_FAILURE");

  const candidates = await deps.sessions.endedSessionsWithLiveEmbeddings(input.asOf);
  const eligible = candidates.filter((s) => isSweepEligible(s.endedAt, input.asOf, fallbackDays));

  const sessions: { sessionId: string; destroyedCount: number; auditEventId: string }[] = [];
  for (const s of eligible) {
    const result = await destroyAndCascade(deps, s.sessionId, "fallback-d7", input.actor, input.asOf);
    if (!result.ok) return result;
    sessions.push({
      sessionId: s.sessionId,
      destroyedCount: result.destroyedCount,
      auditEventId: result.auditEventId,
    });
  }

  return { ok: true, sessions };
}
