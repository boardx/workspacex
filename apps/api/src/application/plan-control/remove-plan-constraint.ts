/**
 * UC-6 `removePlanConstraint` —— 撤掉一条约束，含孤儿（`usecases.md` UC-6）。
 *
 * 「加得进去、撤不掉的东西不是可编辑」——本 use case 覆盖两种目标：约束还挂在某个
 * 现存 step 上（正常撤销，产生新 revision），或约束已经是孤儿（`chat_plan_orphan_
 * constraints` 里的一行，真删除，不产生新 revision——那张表的生命周期本就不随
 * `chat_plan_ledgers` 的 revision 演进，见 F972 migration 的表头注释）。
 *
 * ⚠ `usecases.md` UC-6 的 `err` 数组里**没有**「约束不存在」这个码——目标已经不在
 * 任何一处时按幂等成功处理（`revision` 不变，仍然写一条审计事件，因为 `auditEventId`
 * 是必填出参）。
 */
import type { PlanAppliedTo } from "@repo/contracts/plan-control";
import type { ProvenanceWriter } from "../provenance/ports";
import type { OrgId } from "../../domain/org-id";
import { PlanEditError } from "./plan-edit-errors";
import { determineAppliedTo, withPlanEditTransaction, type PlanEditDeps } from "./plan-edit-support";

export interface RemovePlanConstraintInput {
  readonly orgId: OrgId;
  readonly threadId: string;
  readonly actorId: string;
  readonly basedOnRevision: number;
  readonly constraintId: string;
}

export interface RemovePlanConstraintOutput {
  readonly revision: number;
  readonly appliedTo: PlanAppliedTo;
  readonly auditEventId: string;
}

export async function removePlanConstraint(
  deps: PlanEditDeps, provenance: ProvenanceWriter, input: RemovePlanConstraintInput,
): Promise<RemovePlanConstraintOutput> {
  const appliedTo = await determineAppliedTo(deps.runs, input.orgId, input.threadId);

  const { revision, auditEventId } = await withPlanEditTransaction(
    deps.db, input.orgId, input.threadId,
    async (session, appendAudit) => {
      const latest = await deps.repo.getLatestWithin(session, input.threadId);
      if (latest === null) throw new PlanEditError("PLAN_NOT_FOUND");
      if (latest.revision !== input.basedOnRevision) throw new PlanEditError("PLAN_REVISION_CHANGED");

      const stepIdx = latest.steps.findIndex(
        (s) => s.constraints.some((c) => c.constraintId === input.constraintId),
      );

      if (stepIdx !== -1) {
        const steps = latest.steps.map((s, i) => i !== stepIdx ? s : {
          ...s, constraints: s.constraints.filter((c) => c.constraintId !== input.constraintId),
        });
        const written = await deps.repo.appendUserEditWithin(session, {
          orgId: input.orgId, threadId: input.threadId, basedOnRevision: latest.revision,
          engineEpoch: latest.engineEpoch, steps, createdBy: input.actorId,
        });
        const auditEventId = await appendAudit(provenance, {
          actorId: input.actorId, action: "removePlanConstraint",
          detail: { constraintId: input.constraintId, revision: written.revision, wasOrphan: false },
        });
        return { revision: written.revision, auditEventId };
      }

      // Not attached to any live step -- try the orphan table (I-8's other half: a
      // pending orphan can be dismissed by the user's own explicit undo).
      const deletedOrphan = await deps.repo.deleteOrphanedConstraintWithin(
        session, input.orgId, input.threadId, input.constraintId,
      );
      const auditEventId = await appendAudit(provenance, {
        actorId: input.actorId, action: "removePlanConstraint",
        detail: {
          constraintId: input.constraintId, revision: latest.revision,
          wasOrphan: deletedOrphan, foundAnywhere: deletedOrphan,
        },
      });
      // Idempotent: whether or not the constraint existed anywhere, the ledger's current
      // revision is unchanged -- removing (or already having removed) a constraint never
      // mints a new revision unless it was attached to a live step (handled above).
      return { revision: latest.revision, auditEventId };
    },
  );

  return { revision, appliedTo, auditEventId };
}
