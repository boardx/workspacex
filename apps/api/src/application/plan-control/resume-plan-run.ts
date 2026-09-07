/** Resume the same logical run through the existing executor checkpoint path.
 * A new synthetic user message is not checkpoint recovery and may repeat side effects.
 */
import type { OrgId } from "../../domain/org-id";
import type { ProvenanceWriter } from "../provenance/ports";
import { PlanEditError } from "./plan-edit-errors";
import type { PlanRunCreator } from "./plan-run-creator-port";
import type { PlanRunStatusReader } from "./ports";

export interface ResumePlanRunInput {
  readonly orgId: OrgId;
  readonly threadId: string;
  readonly actorId: string;
}

export interface ResumePlanRunOutput {
  readonly runId: string;
  /** 步骤级颗粒度读不到，如实返回 null（同 `pausePlanRun.pausedAtStepId` 的理由）。 */
  readonly resumedFromStepId: string | null;
  readonly auditEventId: string;
}

export interface ResumePlanRunDeps {
  readonly runs: PlanRunStatusReader;
  readonly runCreator: PlanRunCreator;
  readonly provenance: ProvenanceWriter;
}

export async function resumePlanRun(
  deps: ResumePlanRunDeps, input: ResumePlanRunInput,
): Promise<ResumePlanRunOutput> {
  const latest = await deps.runs.getLatestRun(input.orgId, input.threadId);
  // NO_PAUSED_STATE 覆盖两种情况：这条线程从未暂停过（latest 为 null 或 pausedAt 为
  // null），或暂停后已经有更新的动作产生了新状态——本 use case 只认「最近一条 run
  // 恰好带 pausedAt」这一种可恢复态，其余一律 NO_PAUSED_STATE（coverage.md 缺口 9
  // 明确把"暂停后又发生别的编辑该怎么办"标为未定，本轮先诚实拒绝，不猜）。
  if (latest === null || latest.pausedAt === null) throw new PlanEditError("NO_PAUSED_STATE");

  let runId: string;
  try {
    if (!deps.runCreator.resumeCheckpoint) throw new Error("checkpoint resume is unavailable");
    const created = await deps.runCreator.resumeCheckpoint({
      orgId: input.orgId, threadId: input.threadId, actorId: input.actorId, runId: latest.runId,
    });
    runId = created.runId;
  } catch (error) {
    if (error instanceof PlanEditError) throw error;
    throw new Error("resumePlanRun: checkpoint resume failed", { cause: error });
  }

  let auditEventId: string;
  try {
    auditEventId = await deps.provenance.append({
      orgId: input.orgId, type: "human-edited", actorId: input.actorId,
      target: { kind: "thread", id: input.threadId },
      detail: { action: "resumePlanRun", runId },
    });
  } catch {
    throw new PlanEditError("AUDIT_SINK_UNAVAILABLE");
  }

  return { runId, resumedFromStepId: null, auditEventId };
}
