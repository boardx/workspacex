/**
 * UC-5 `addPlanConstraint` —— 加约束（`usecases.md` UC-5）。
 *
 * 约束怎么进入下一轮：已裁决——「A system 注入」（F975 `UC-12 deliverPlanToRun` 落地那件事），
 * 本 use case 只负责让约束真的写进账本、挂在正确的 step 上。空白/超 500 字被拒。
 */
import { randomUUID } from "node:crypto";
import type { PlanAppliedTo } from "@repo/contracts/plan-control";
import type { ProvenanceWriter } from "../provenance/ports";
import type { OrgId } from "../../domain/org-id";
import { PlanEditError } from "./plan-edit-errors";
import { determineAppliedTo, withPlanEditTransaction, type PlanEditDeps } from "./plan-edit-support";

const MAX_CONSTRAINT_LENGTH = 500;

export interface AddPlanConstraintInput {
  readonly orgId: OrgId;
  readonly threadId: string;
  readonly actorId: string;
  readonly basedOnRevision: number;
  readonly planStepId: string;
  readonly text: string;
}

export interface AddPlanConstraintOutput {
  readonly revision: number;
  readonly constraintId: string;
  readonly appliedTo: PlanAppliedTo;
  readonly auditEventId: string;
}

export async function addPlanConstraint(
  deps: PlanEditDeps, provenance: ProvenanceWriter, input: AddPlanConstraintInput,
): Promise<AddPlanConstraintOutput> {
  if (input.text.trim() === "") throw new PlanEditError("PLAN_CONSTRAINT_BLANK");
  if (input.text.length > MAX_CONSTRAINT_LENGTH) throw new PlanEditError("PLAN_CONSTRAINT_TOO_LONG");

  const appliedTo = await determineAppliedTo(deps.runs, input.orgId, input.threadId);
  const constraintId = randomUUID();

  const { revision, auditEventId } = await withPlanEditTransaction(
    deps.db, input.orgId, input.threadId,
    async (session, appendAudit) => {
      const latest = await deps.repo.getLatestWithin(session, input.threadId);
      if (latest === null) throw new PlanEditError("PLAN_NOT_FOUND");
      if (latest.revision !== input.basedOnRevision) throw new PlanEditError("PLAN_REVISION_CHANGED");

      const idx = latest.steps.findIndex((s) => s.planStepId === input.planStepId);
      if (idx === -1) throw new PlanEditError("PLAN_STEP_NOT_FOUND");

      const createdAt = new Date().toISOString();
      const steps = latest.steps.map((s, i) => i !== idx ? s : {
        ...s,
        constraints: [...s.constraints, { constraintId, text: input.text, createdAt }],
      });

      const written = await deps.repo.appendUserEditWithin(session, {
        orgId: input.orgId, threadId: input.threadId, basedOnRevision: latest.revision,
        engineEpoch: latest.engineEpoch, steps, createdBy: input.actorId,
      });

      const auditEventId = await appendAudit(provenance, {
        actorId: input.actorId, action: "addPlanConstraint",
        detail: { planStepId: input.planStepId, constraintId, revision: written.revision },
      });

      return { revision: written.revision, auditEventId };
    },
  );

  return { revision, constraintId, appliedTo, auditEventId };
}
