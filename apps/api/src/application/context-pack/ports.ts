/**
 * Ports F12 needs: reading a run back, and recording a refused citation.
 *
 * Defined here, implemented by `infrastructure`. **F12 ships no PostgreSQL implementation** --
 * `ContextPackStore` persistence is F13's (`context_packs`), and building a table now would be
 * guessing at the shape F13 has to live with. What F12 owns is the SHAPE of the question the
 * gate and the citation check ask of a run.
 */
import type { RunState } from "../../domain/context-pack/ai-gate";
import type { ContextPack } from "../../domain/context-pack/pack-structure";

/** `RUN_NOT_FOUND` -- the contract's code, carried rather than re-invented at the edge. */
export class RunNotFoundError extends Error {
  readonly reason = "RUN_NOT_FOUND" as const;
  constructor(readonly runId: string) {
    super(`no context-pack run "${runId}"`);
  }
}

export interface ContextRunStore {
  /**
   * The run's gate-relevant state, or undefined if there is no such run.
   *
   * Returns a `RunState` rather than a `ContextPack` because a run whose retrieval failed has
   * no pack and still has to be answerable -- see the note on `RunState`.
   */
  gateState(runId: string): Promise<RunState | undefined>;
  /** The assembled pack, for citation checking. Undefined for unknown AND for failed runs. */
  pack(runId: string): Promise<ContextPack | undefined>;
}

/**
 * One refused citation, as recorded.
 *
 * ⚠ **Contract gap, deliberately not papered over.** V1 says 引用包外证据被拒**并记录**, and
 * there is nowhere in the signed contract to record it:
 *
 *   - `provenance.ProvenanceEventType` is a closed enum (new members require an ADR, same
 *     ruling as the omission reasons) and none of its 17 members means "the model cited
 *     evidence that was not in its pack". The nearest, `unauthorized-attempt`, is the security
 *     channel: a hallucinating model would flood it and bury the real intrusion attempts it
 *     exists to surface. Writing it there is a lie that costs something.
 *   - `ProvenanceEvent.target.kind` has no member that can name a run or a segment, so even
 *     with an event type the record could not say what it was about.
 *
 * So this port is F12-local and its records do not yet reach the one audit surface (coherence
 * X-2 says there must be exactly one). That is a gap, not a design: asserted in
 * `tests/kernel/citation-integrity.test.ts` so that it turns red when the contract gains a
 * home for it. Inventing an event type here would have closed the gap on paper and left the
 * audit trail wrong.
 */
export interface CitationRejectionRecord {
  readonly runId: string;
  readonly citedSegmentIds: readonly string[];
  readonly offendingSegmentIds: readonly string[];
}

export interface CitationRejectionRecorder {
  /**
   * Persist a refusal. **May throw** -- and callers must let it: see `verify-citation.ts`.
   */
  record(record: CitationRejectionRecord): Promise<void>;
}

export const CONTEXT_RUN_STORE = Symbol("ContextRunStore");
export const CITATION_REJECTION_RECORDER = Symbol("CitationRejectionRecorder");

/**
 * Ports for the auditable-discard-list side of the bundle (F11).
 *
 * ⚠ Only the READ side is here. `ContextPackStore` in `usecases.md` also persists packs, and
 * F11 deliberately does not define the write half: the storage shape belongs with replay and
 * pinning (F13, `context_packs`), and a store interface written now to satisfy one reader would
 * be guessed twice -- once here and once when the table actually exists. F09 made the same call
 * about not creating a migration it could only guess at.
 */
import type { z } from "zod";
import type { contextPack as CP } from "@repo/contracts";
import type { ContextItem } from "../../domain/context-pack/context-item";
import type { Omission } from "../../domain/context-pack/pack-structure";
import type { OrgId } from "../../domain/org-id";

/** What `listOmissions` needs to answer for one run. Less than a whole pack, on purpose. */
export interface StoredPackAudit {
  readonly runId: string;
  readonly orgId: OrgId;
  readonly items: readonly ContextItem[];
  readonly omissions: readonly Omission[];
  /**
   * The threshold THIS run used -- read back, never recomputed.
   *
   * Recomputing it from `THRESHOLDS` at read time would silently re-answer the question with
   * today's configuration: after a per-task override lands (O-36 allows it), an audit of an old
   * run would report a threshold that run never applied, and every "相关度 0.38 < 0.45" line in
   * the discard list would become a statement about a different assembly.
   */
  readonly thresholdUsed: number;
}

export interface ContextPackAuditStore {
  /** null when the runId is unknown -- the caller raises RUN_NOT_FOUND. */
  findAudit(runId: string): Promise<StoredPackAudit | null>;
}

export const CONTEXT_PACK_AUDIT_STORE = Symbol("ContextPackAuditStore");

export type ListOmissionsOut = z.infer<typeof CP.operations.listOmissions.out>;

/* ───────────────────────── F13: persistence, replay, pinning ───────────────────────── */

import type { RecordedRun } from "../../domain/context-pack/recorded-run";
import type { SelectableModel } from "../../domain/context-pack/model-routing";
import type { ModelConstraint } from "../../domain/identity/model-constraint";

/**
 * A recorded run as it comes back out of storage.
 *
 * ⚠ **There is no `pack` field here, and that absence is the feature.** F09, F11 and F12 each
 * left persistence to F13 saying "building a table now would be guessing at the shape";
 * the shape it turned out to need is INPUTS, not output. A `pack` column would make
 * `replayContextPack` a `SELECT`, and every assertion about replay would then be an assertion
 * about the database's ability to return what was put in it. `context_packs` (migration 0016)
 * has no column able to hold an item, and `context-pack-pinned-replay.test.ts` asserts that
 * against `information_schema` so the absence cannot be quietly reversed.
 */
export interface RecordedRunRow {
  readonly run: RecordedRun;
  /** The digest of the pack this run produced when it produced it. Replay is checked against it. */
  readonly contentHash: string;
  /** Non-null once the run has been frozen onto a snapshot (I-7). */
  readonly pinnedSnapshotId: string | null;
}

export interface PinRecord {
  readonly runId: string;
  readonly snapshotId: string;
  readonly artifactVersionId: string;
  readonly contentHash: string;
  readonly frozenItemCount: number;
}

/**
 * Persistence for the bundle. The write half F09/F11/F12 deliberately did not guess at.
 *
 * `ContextRunStore` and `ContextPackAuditStore` (above) are the two read shapes that already
 * existed; one implementation answers all three, because they are three questions about ONE
 * row and two rows is how the gate's answer and the audit's answer come to disagree.
 */
export interface ContextPackStore {
  /** Record a successful assembly. `contentHash` is the digest of the pack it produced. */
  record(run: RecordedRun, contentHash: string): Promise<void>;
  /**
   * Record a run whose retrieval failed.
   *
   * A failed assembly is a STATE, not the absence of one -- see the note on `RunState`. Without
   * this, `RETRIEVAL_UNAVAILABLE` would be unreachable from `gateAiCall`, whose only input is
   * a runId, and the gate would answer `RUN_NOT_FOUND` ("check your id") to an outage.
   */
  recordFailure(input: { readonly runId: string; readonly orgId: OrgId }): Promise<void>;
  findRecorded(runId: string): Promise<RecordedRunRow | null>;
  /** `"assembled" | "retrieval-unavailable"`, or null for an unknown run. */
  findStatus(runId: string): Promise<"assembled" | "retrieval-unavailable" | null>;
  /** Freeze the run onto a snapshot. Write-once: a second pin of the same run must fail. */
  pin(record: PinRecord): Promise<void>;
  /**
   * Which of these segments are confidential AS OF NOW.
   *
   * Unioned with the recorded flags rather than replacing them -- see
   * `resolve-pack-model-constraint.ts` for why neither side alone is safe.
   */
  confidentialNow(orgId: OrgId, segmentIds: readonly string[]): Promise<ReadonlySet<string>>;
  /** The models this organization has configured, for V9's "只返回自托管模型" filter. */
  listModels(orgId: OrgId): Promise<readonly SelectableModel[]>;
}

export const CONTEXT_PACK_STORE = Symbol("ContextPackStore");

/**
 * The delegation the contract demands, expressed as a port rather than as an import.
 *
 * `resolvePackModelConstraint`'s doc comment says, in the imperative: 委托给
 * `identity.resolveModelConstraint`，不重新判定. A port makes that structural -- this bundle's
 * use case has no way to reach a rule of its own, because the only thing in scope is somebody
 * else's answer.
 */
export interface ModelConstraintPort {
  resolve(input: {
    readonly userId: string;
    readonly orgId: OrgId;
    readonly dataScope: readonly { readonly itemId: string; readonly confidential: boolean }[];
  }): Promise<ModelConstraint>;
}

export const MODEL_CONSTRAINT_PORT = Symbol("ModelConstraintPort");

/**
 * `PIN_REQUIRES_SNAPSHOT` -- the target is not a 固定快照.
 *
 * ⚠ The criterion is F07's, imported rather than re-decided: an `artifact_versions` row is
 * immutable by construction, so "is this version a snapshot" read literally is always true and
 * the refusal would be unreachable. Eligibility is a property of the BINDING
 * (`domain/artifact/downstream-eligibility.judgeCitation`). Re-deciding it here would give this
 * bundle a second answer to a question the artifact bundle already answers, and the two would
 * differ exactly when a version is bound `live`.
 */
export class PinRequiresSnapshotError extends Error {
  readonly reason = "PIN_REQUIRES_SNAPSHOT" as const;
  constructor(readonly artifactVersionId: string, detail: string) {
    super(`cannot pin a context pack to ${artifactVersionId}: ${detail}`);
  }
}
