/**
 * Ports for `provenance_events` -- the append-only audit trail.
 *
 * ⚠ ONE table, ONE query surface (coherence review X-2). The `identity` and `artifact`
 * bundles both write here; neither owns it. The contract that describes it lives in
 * `packages/contracts/src/provenance.ts` precisely so that neither bundle grows its own
 * `queryProvenance` with its own filters and its own return shape -- at which point
 * "check the audit log" means two different things depending on who you ask.
 *
 * There is a `ProvenanceWriter` and a reader, and NO updater or deleter. That absence is
 * the contract: append-only means the port cannot express a mutation, so no implementation
 * can offer one. (The database enforces the same thing from the other side -- the runtime
 * role holds SELECT and INSERT only.)
 */
import { provenance } from "@repo/contracts";
import type { z } from "zod";
import type { TenantSession } from "../ports/database.port";
import type { OrgId } from "../../domain/org-id";

/** Derived from the shared contract, never restated. */
export type ProvenanceEventRecord = z.infer<typeof provenance.ProvenanceEvent>;
export type ProvenanceEventKind = z.infer<typeof provenance.ProvenanceEventType>;
export type ProvenanceQuery = z.infer<typeof provenance.operations.queryProvenance.in>;
export type ProvenancePage = z.infer<typeof provenance.operations.queryProvenance.out>;

export interface ProvenanceAppendInput {
  readonly orgId: OrgId;
  readonly type: ProvenanceEventKind;
  readonly actorId: string;
  readonly target: ProvenanceEventRecord["target"];
  readonly detail: Record<string, unknown>;
}

export interface ProvenanceWriter {
  /** Returns the new event's id. Throws if it could not be persisted -- see read-content. */
  append(input: ProvenanceAppendInput): Promise<string>;

  /**
   * The same append, inside a transaction the CALLER already owns (F17).
   *
   * ## Why this exists rather than a second INSERT somewhere
   *
   * V11④ says an export writes provenance on BOTH sides, and F17's whole position is that an
   * export whose audit did not land must not have happened. That is one transaction spanning
   * two tenants -- and `append` cannot participate in it, because it opens its own.
   *
   * The alternative was for the export repository to write its own INSERT into
   * `provenance_events`. That is a second declaration of how an audit event is written, in
   * the one table where "was this recorded" has to have exactly one answer. So the port grows
   * a method instead, and there stays ONE implementation of the insert.
   *
   * ⚠ The caller is responsible for the tenant context: this method does NOT set
   * `app.current_org`, because it does not own the transaction. That is the price of the
   * shape, stated rather than left to be discovered -- an export writes the target event
   * under the target tenant and the local event under the local one, by re-pointing the
   * transaction-local setting between them.
   */
  appendWithin(session: TenantSession, input: ProvenanceAppendInput): Promise<string>;
}

export interface ProvenanceReader {
  query(orgId: OrgId, q: Omit<ProvenanceQuery, "orgId">): Promise<ProvenancePage>;
}

/**
 * Telling a person that something they signed off on now rests on withdrawn evidence (E5).
 *
 * A port rather than a return value. `markEvidenceWithdrawn.out` promises
 * `notifiedApprovers`, and a use case that computes that list and tells nobody satisfies
 * every assertion anyone would think to write while leaving the one person who has to act
 * uninformed. So "notified" has to mean something durable, and the durable thing is a row
 * (`provenance_notifications`, migration 0010).
 *
 * ⚠ It takes a `provenanceEventId`, not a reason and not a target. The notice is a POINTER
 * at the audit event; copying the reason into it would put "which evidence was withdrawn and
 * why" in two places, and the two would diverge the first time one of them is edited.
 */
export interface ReviewNotifier {
  /**
   * Record a review notice for each recipient. Idempotent per (event, recipient): re-running
   * a withdrawal must not double an inbox.
   *
   * Returns the recipients now on record for this event -- which is what the use case
   * reports, so the response cannot claim somebody was notified when the row is absent.
   */
  notify(
    orgId: OrgId,
    provenanceEventId: string,
    recipientIds: readonly string[],
  ): Promise<readonly string[]>;
}

export const PROVENANCE_WRITER = Symbol("ProvenanceWriter");
export const PROVENANCE_READER = Symbol("ProvenanceReader");
export const REVIEW_NOTIFIER = Symbol("ReviewNotifier");
