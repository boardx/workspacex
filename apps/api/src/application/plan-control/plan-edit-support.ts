/**
 * Shared plumbing for the four F974 edit use cases (UC-3 `reorderPlanStep`, UC-4
 * `deletePlanStep`, UC-5 `addPlanConstraint`, UC-6 `removePlanConstraint`).
 *
 * ## Why one shared helper, not four copies
 *
 * `usecases.md`'s header for the B group is explicit: "三个 UC 共享同一条并发纪律"
 * (I-5, `basedOnRevision` check) "共享同一条执行期纪律" (I-11, `appliedTo`). Four
 * independent implementations of "read latest, check revision, and derive appliedTo"
 * is exactly the shape that drifts apart the second someone fixes it in one place and
 * not the other three — this repo's CLAUDE.md calls that out by name.
 *
 * ## Audit atomicity (I-13, fail-closed)
 *
 * `withPlanEditTransaction` opens ONE transaction (`DatabasePort.withTenant`) that the
 * ledger write and the audit write (`ProvenanceWriter.appendWithin`) both run inside.
 * If the audit write throws, the whole transaction rolls back -- so "a ledger row exists
 * but nobody can prove it was authorised" is not a reachable state, which is what I-13
 * actually demands (not just "return an error code", but "the row must not exist either").
 */
import type { PlanAppliedTo } from "@repo/contracts/plan-control";
import type { DatabasePort, TenantSession } from "../ports/database.port";
import type { ProvenanceWriter } from "../provenance/ports";
import type { OrgId } from "../../domain/org-id";
import type { PlanLedgerRepository, PlanRunStatusReader } from "./ports";
import { PlanEditError } from "./plan-edit-errors";

/**
 * ⚠ Deliberately does NOT include `ProvenanceWriter`: every one of the four edit use
 * cases takes it as its own explicit second parameter instead of folding it into this
 * bag. `ProvenanceWriter` is wired via `PROVENANCE_WRITER`'s existing DI token
 * (`kernel.module.ts`), a DIFFERENT provider from the three fields below -- keeping it
 * out of `PlanEditDeps` means a caller cannot accidentally construct this bag with a
 * stale/wrong writer and have it silently compile.
 */
export interface PlanEditDeps {
  readonly db: DatabasePort;
  readonly repo: PlanLedgerRepository;
  readonly runs: PlanRunStatusReader;
}

const ACTIVE_RUN_STATUSES = new Set(["running"]);

/**
 * I-11's read side: is there an active run right now? If so, this edit only ever
 * reaches the ledger (`appliedTo:"ledger-only"`) -- never `POST /threads/:id/state`,
 * which this bundle never calls at all (see `domain.md` 三·③). When idle, the edit is
 * tagged `"ledger-and-engine"` because the NEXT run's creation will deliver it via
 * UC-12 `deliverPlanToRun` (F975) -- not because this use case writes anything to the
 * engine directly.
 */
export async function determineAppliedTo(
  runs: PlanRunStatusReader, orgId: OrgId, threadId: string,
): Promise<PlanAppliedTo> {
  const run = await runs.getLatestRun(orgId, threadId);
  return run !== null && ACTIVE_RUN_STATUSES.has(run.status) ? "ledger-only" : "ledger-and-engine";
}

/**
 * Runs `body` inside one tenant transaction. `appendAudit` (bound to the SAME session)
 * is handed to `body` so the ledger write and the audit write commit or roll back
 * together; a `ProvenanceWriter.appendWithin` failure is mapped specifically to
 * `AUDIT_SINK_UNAVAILABLE` -- other failures inside `body` (e.g. a ledger
 * CHECK-constraint violation) propagate unmapped, since they are not what that error
 * code describes and I-13 does not ask this layer to invent a code for every possible
 * database failure, only to guarantee the audit-required ones fail closed.
 *
 * ⚠ **Audit type reused, not invented**: `packages/contracts/src/provenance.ts`'s
 * `ProvenanceEventType` has no `plan-control`-specific member yet (adding one is an
 * ADR, per that file's own header). `"human-edited"` is the SAME reuse F109 already
 * made for `chat` bundle thread-lifecycle audit events (see that file's own comment on
 * `CHAT_LIFECYCLE_AUDIT_TYPE`) -- a known, documented gap, not a fabricated fit. The
 * real action name (`reorderPlanStep`/`deletePlanStep`/…) is recorded in `detail.action`
 * so it stays distinguishable from every other `"human-edited"` event in the trail.
 */
export async function withPlanEditTransaction<T>(
  db: DatabasePort, orgId: OrgId, threadId: string,
  body: (session: TenantSession, appendAudit: AppendAudit) => Promise<T>,
): Promise<T> {
  return db.withTenant(orgId, (session) => {
    const appendAudit: AppendAudit = async (provenance, input) => {
      try {
        return await provenance.appendWithin(session, {
          orgId, type: "human-edited", actorId: input.actorId,
          target: { kind: "thread", id: threadId },
          detail: { action: input.action, ...input.detail },
        });
      } catch {
        throw new PlanEditError("AUDIT_SINK_UNAVAILABLE");
      }
    };
    return body(session, appendAudit);
  });
}

type AppendAudit = (
  provenance: ProvenanceWriter,
  input: { readonly actorId: string; readonly action: string; readonly detail: Record<string, unknown> },
) => Promise<string>;
