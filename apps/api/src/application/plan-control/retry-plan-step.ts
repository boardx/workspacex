/**
 * UC-10 `retryPlanStep` —— 重试某一步（判据六 ①，`usecases.md` UC-10）。
 *
 * 把该 step 及其后续置回 `pending`，写回账本，经送达路径起新一轮 run（复用
 * `PlanRunCreator`，同 F975 confirmPlan / F976 resumePlanRun）。**不是引擎级的
 * "从那个节点继续"**——那需要 checkpoint，本轮不做（人类 2026-08-26 裁决 (c)）。
 *
 * ⚠ 没有 `basedOnRevision`（UC-10 的 `in` 形状本就只有 `{threadId, planStepId}`）：
 * 这不是用户提交的一次基于旧版本的编辑，是系统在"run 已失败"这个既成事实上做的
 * 补救写入，没有第二方在同时编辑同一版本，I-5 的并发纪律因此不适用——直接以
 * 当前最大 revision 为基准写下一版即可。
 */
import type { OrgId } from "../../domain/org-id";
import type { ProvenanceWriter } from "../provenance/ports";
import { PlanEditError } from "./plan-edit-errors";
import { withPlanEditTransaction, type PlanEditDeps } from "./plan-edit-support";
import type { PlanRunCreator } from "./plan-run-creator-port";

export interface RetryPlanStepInput {
  readonly orgId: OrgId;
  readonly threadId: string;
  readonly actorId: string;
  readonly planStepId: string;
}

export interface RetryPlanStepOutput {
  readonly runId: string;
  readonly auditEventId: string;
}

export interface RetryPlanStepDeps extends PlanEditDeps {
  readonly runCreator: PlanRunCreator;
}

const RETRY_MESSAGE_TEXT = "（用户已请求重试失败步骤，请从计划中标记为待办的步骤继续执行。）";

export async function retryPlanStep(
  deps: RetryPlanStepDeps, provenance: ProvenanceWriter, input: RetryPlanStepInput,
): Promise<RetryPlanStepOutput> {
  const run = await deps.runs.getLatestRun(input.orgId, input.threadId);
  // pre: "该 step 处于失败语义（其所属 run 已失败）"——本束没有 step 级失败标记
  // （`PlanStepStatus` 只有 pending/in_progress/completed 三值，domain.md 一·2 明确
  // 不许新造第四个值），失败语义只能读「这条线程最近一次 run 的状态」。
  if (run === null || run.status !== "failed") throw new PlanEditError("NO_ACTIVE_RUN");

  const revision = await withPlanEditTransaction(
    deps.db, input.orgId, input.threadId,
    async (session) => {
      const latest = await deps.repo.getLatestWithin(session, input.threadId);
      if (latest === null) throw new PlanEditError("PLAN_STEP_NOT_FOUND");
      const idx = latest.steps.findIndex((s) => s.planStepId === input.planStepId);
      if (idx === -1) throw new PlanEditError("PLAN_STEP_NOT_FOUND");

      // 该 step 及其后续（数组下标之后的全部）置回 pending——I-4：下标即执行顺序，
      // "后续" 就是数组里排在它之后的那些元素，不需要额外的顺序字段。
      const steps = latest.steps.map((s, i) => (i < idx ? s : { ...s, status: "pending" as const }));

      const written = await deps.repo.appendUserEditWithin(session, {
        orgId: input.orgId, threadId: input.threadId, basedOnRevision: latest.revision,
        engineEpoch: latest.engineEpoch, steps, createdBy: input.actorId,
      });
      return written.revision;
    },
  );

  let runId: string;
  try {
    const created = await deps.runCreator.createConfirmedRun({
      orgId: input.orgId, threadId: input.threadId, actorId: input.actorId,
      messageText: RETRY_MESSAGE_TEXT,
    });
    runId = created.runId;
  } catch {
    throw new Error("retryPlanStep: failed to create the retry run");
  }

  let auditEventId: string;
  try {
    auditEventId = await provenance.append({
      orgId: input.orgId, type: "human-edited", actorId: input.actorId,
      target: { kind: "thread", id: input.threadId },
      detail: { action: "retryPlanStep", planStepId: input.planStepId, revision, runId },
    });
  } catch {
    throw new PlanEditError("AUDIT_SINK_UNAVAILABLE");
  }

  return { runId, auditEventId };
}
