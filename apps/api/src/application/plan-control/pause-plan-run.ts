/**
 * UC-9 `pausePlanRun` —— 暂停（`usecases.md` UC-9，可恢复的中止，人类 2026-08-26 裁决）。
 *
 * 语义：`POST /threads/{remoteThreadId}/runs/{remoteRunId}/cancel?action=interrupt`
 * ——保留已完成步骤，不是丢弃进度的 rollback（domain.md I-12 的证据链）。
 */
import type { OrgId } from "../../domain/org-id";
import type { ProvenanceWriter } from "../provenance/ports";
import { PlanEditError } from "./plan-edit-errors";
import type { EngineRunController } from "./engine-run-controller-port";
import type { PlanRunStatusReader } from "./ports";

export interface PausePlanRunInput {
  readonly orgId: OrgId;
  readonly threadId: string;
  readonly actorId: string;
}

export interface PausePlanRunOutput {
  readonly runId: string;
  /** 步骤级颗粒度读不到（`EngineStateReader` "当前读不到"，`usecases.md` 端口表原话）
   * ——如实返回 `null`，不编一个假的当前步骤 id。 */
  readonly pausedAtStepId: string | null;
  readonly auditEventId: string;
}

export interface PausePlanRunDeps {
  readonly runs: PlanRunStatusReader;
  readonly engine: EngineRunController;
  readonly provenance: ProvenanceWriter;
}

export async function pausePlanRun(
  deps: PausePlanRunDeps, input: PausePlanRunInput,
): Promise<PausePlanRunOutput> {
  const run = await deps.runs.getLatestRun(input.orgId, input.threadId);
  if (run === null) throw new PlanEditError("NO_ACTIVE_RUN");
  if (run.pausedAt !== null) {
    // 已经暂停过、还没有新 run 覆盖它——再次暂停没有对象，同 usecases.md 的
    // "没有活跃 run，pause / retry-step 无对象" 一并处理为 NO_ACTIVE_RUN。
    throw new PlanEditError("NO_ACTIVE_RUN");
  }
  if (run.status === "succeeded" || run.status === "failed") {
    throw new PlanEditError("RUN_ALREADY_TERMINAL");
  }
  if (run.status !== "running") {
    // idle（无 run 行本身已在上面处理）——不应到达这里，防御性地按 NO_ACTIVE_RUN 处理。
    throw new PlanEditError("NO_ACTIVE_RUN");
  }
  if (run.remoteRunId === null) {
    // P-2 的短暂窗口：远端 run 已创建但 onRemoteRunStarted 的写入还没落地/丢了。
    // 没有 remoteRunId 就没有可 cancel 的对象——如实报 NO_ACTIVE_RUN，不假装暂停成功。
    throw new PlanEditError("NO_ACTIVE_RUN");
  }

  await deps.engine.cancelRun(input.threadId, run.remoteRunId);
  await deps.runs.markRunPaused(input.orgId, run.runId);

  let auditEventId: string;
  try {
    auditEventId = await deps.provenance.append({
      orgId: input.orgId, type: "human-edited", actorId: input.actorId,
      target: { kind: "thread", id: input.threadId },
      detail: { action: "pausePlanRun", runId: run.runId },
    });
  } catch {
    throw new PlanEditError("AUDIT_SINK_UNAVAILABLE");
  }

  return { runId: run.runId, pausedAtStepId: null, auditEventId };
}
