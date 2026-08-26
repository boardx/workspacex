/**
 * UC-4 `deletePlanStep` —— 删步骤（`usecases.md` UC-4，I-8：带约束的步骤删除后约束转孤儿）。
 *
 * 删到 0 步被拒（`PLAN_EMPTY_NOT_ALLOWED`）。删 `status="completed"` 的步骤是允许的
 * （人类已确认，`design-signoff.md`）——它只从计划视图移走，不改写已发生的事实。
 */
import type { PlanAppliedTo } from "@repo/contracts/plan-control";
import type { ProvenanceWriter } from "../provenance/ports";
import type { OrgId } from "../../domain/org-id";
import { PlanEditError } from "./plan-edit-errors";
import { determineAppliedTo, withPlanEditTransaction, type PlanEditDeps } from "./plan-edit-support";

export interface DeletePlanStepInput {
  readonly orgId: OrgId;
  readonly threadId: string;
  readonly actorId: string;
  readonly basedOnRevision: number;
  readonly planStepId: string;
}

export interface DeletePlanStepOutput {
  readonly revision: number;
  readonly appliedTo: PlanAppliedTo;
  readonly orphanedConstraintIds: string[];
  readonly auditEventId: string;
}

export async function deletePlanStep(
  deps: PlanEditDeps, provenance: ProvenanceWriter, input: DeletePlanStepInput,
): Promise<DeletePlanStepOutput> {
  const appliedTo = await determineAppliedTo(deps.runs, input.orgId, input.threadId);

  const { revision, orphanedConstraintIds, auditEventId } = await withPlanEditTransaction(
    deps.db, input.orgId, input.threadId,
    async (session, appendAudit) => {
      const latest = await deps.repo.getLatestWithin(session, input.threadId);
      if (latest === null) throw new PlanEditError("PLAN_NOT_FOUND");
      if (latest.revision !== input.basedOnRevision) throw new PlanEditError("PLAN_REVISION_CHANGED");

      const idx = latest.steps.findIndex((s) => s.planStepId === input.planStepId);
      if (idx === -1) throw new PlanEditError("PLAN_STEP_NOT_FOUND");
      if (latest.steps.length === 1) throw new PlanEditError("PLAN_EMPTY_NOT_ALLOWED");

      const removed = latest.steps[idx]!;
      const steps = latest.steps.filter((_, i) => i !== idx);

      const written = await deps.repo.appendUserEditWithin(session, {
        orgId: input.orgId, threadId: input.threadId, basedOnRevision: latest.revision,
        engineEpoch: latest.engineEpoch, steps, createdBy: input.actorId,
      });

      // I-8: the removed step's constraints do NOT vanish -- they become orphans, in the
      // SAME transaction as the ledger write (a step that "successfully" got removed while
      // its constraints silently disappeared is the exact data loss I-8 forbids).
      if (removed.constraints.length > 0) {
        await deps.repo.insertOrphanedConstraintsWithin(session, {
          orgId: input.orgId, threadId: input.threadId, orphanedAtRevision: written.revision,
          formerStepContent: removed.content,
          constraints: removed.constraints.map((c) => ({ constraintId: c.constraintId, text: c.text })),
        });
      }
      const orphanedConstraintIds = removed.constraints.map((c) => c.constraintId);

      const auditEventId = await appendAudit(provenance, {
        actorId: input.actorId, action: "deletePlanStep",
        detail: { planStepId: input.planStepId, revision: written.revision, orphanedConstraintIds },
      });

      return { revision: written.revision, orphanedConstraintIds, auditEventId };
    },
  );

  return { revision, appliedTo, orphanedConstraintIds, auditEventId };
}
