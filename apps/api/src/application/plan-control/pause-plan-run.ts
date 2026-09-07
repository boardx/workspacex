/** Request a checkpoint pause at the next model boundary. The HTTP response
 * acknowledges intent; only a kernel user_pause interrupt confirms paused_at.
 */
import type { ModelCallPort } from "../agent-run/ports";
import type { InterjectionStore } from "../agent-run/interjection-store";
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
  readonly status: "pause_requested";
  /** 步骤级颗粒度读不到（`EngineStateReader` "当前读不到"，`usecases.md` 端口表原话）
   * ——如实返回 `null`，不编一个假的当前步骤 id。 */
  readonly pausedAtStepId: string | null;
  readonly auditEventId: string;
}

export interface PausePlanRunDeps {
  readonly interjections?: InterjectionStore;
  readonly model?: ModelCallPort;
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

  if (!run.modelProvider || !deps.model?.supportsLiveInterjections?.(run.modelProvider)) {
    throw new PlanEditError("NO_ACTIVE_RUN");
  }

  // A request is not a pause. The Python before_model boundary creates a durable
  // interrupt, and the executor confirms paused_at after observing that interrupt.
  if (!deps.interjections?.requestPause || !await deps.interjections.requestPause(input.orgId, run.runId)) {
    throw new PlanEditError("NO_ACTIVE_RUN");
  }

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

  return { runId: run.runId, status: "pause_requested", pausedAtStepId: null, auditEventId };
}
