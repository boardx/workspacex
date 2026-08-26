/**
 * UC-3 `reorderPlanStep` —— 调顺序（`usecases.md` UC-3，I-4：数组下标即执行顺序）。
 *
 * `toIndex` 越界钳制到边界，不报错（拖拽 UI 天然会产生越界值）。`planStepId` 集合、
 * 每个 step 自己的内容与 constraints 都不变——只有数组下标变。
 */
import type { ProvenanceWriter } from "../provenance/ports";
import type { OrgId } from "../../domain/org-id";
import { PlanEditError } from "./plan-edit-errors";
import { determineAppliedTo, withPlanEditTransaction, type PlanEditDeps } from "./plan-edit-support";
import type { PlanAppliedTo } from "@repo/contracts/plan-control";

export interface ReorderPlanStepInput {
  readonly orgId: OrgId;
  readonly threadId: string;
  readonly actorId: string;
  readonly basedOnRevision: number;
  readonly planStepId: string;
  readonly toIndex: number;
}

export interface ReorderPlanStepOutput {
  readonly revision: number;
  readonly appliedTo: PlanAppliedTo;
  readonly auditEventId: string;
}

export async function reorderPlanStep(
  deps: PlanEditDeps, provenance: ProvenanceWriter, input: ReorderPlanStepInput,
): Promise<ReorderPlanStepOutput> {
  const appliedTo = await determineAppliedTo(deps.runs, input.orgId, input.threadId);

  const { revision, auditEventId } = await withPlanEditTransaction(
    deps.db, input.orgId, input.threadId,
    async (session, appendAudit) => {
      const latest = await deps.repo.getLatestWithin(session, input.threadId);
      if (latest === null) throw new PlanEditError("PLAN_NOT_FOUND");
      if (latest.revision !== input.basedOnRevision) throw new PlanEditError("PLAN_REVISION_CHANGED");

      const idx = latest.steps.findIndex((s) => s.planStepId === input.planStepId);
      if (idx === -1) throw new PlanEditError("PLAN_STEP_NOT_FOUND");

      // I-4: no separate `order`/`sortKey` field -- reordering IS moving the array element.
      const clampedIndex = Math.max(0, Math.min(input.toIndex, latest.steps.length - 1));
      const steps = [...latest.steps];
      const [moved] = steps.splice(idx, 1);
      steps.splice(clampedIndex, 0, moved!);

      const written = await deps.repo.appendUserEditWithin(session, {
        orgId: input.orgId, threadId: input.threadId, basedOnRevision: latest.revision,
        engineEpoch: latest.engineEpoch, steps, createdBy: input.actorId,
      });

      const auditEventId = await appendAudit(provenance, {
        actorId: input.actorId, action: "reorderPlanStep",
        detail: { planStepId: input.planStepId, toIndex: clampedIndex, revision: written.revision },
      });

      return { revision: written.revision, auditEventId };
    },
  );

  return { revision, appliedTo, auditEventId };
}
