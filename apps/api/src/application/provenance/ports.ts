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
}

export interface ProvenanceReader {
  query(orgId: OrgId, q: Omit<ProvenanceQuery, "orgId">): Promise<ProvenancePage>;
}

export const PROVENANCE_WRITER = Symbol("ProvenanceWriter");
export const PROVENANCE_READER = Symbol("ProvenanceReader");
