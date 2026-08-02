/**
 * F43 -- uc-22-3 R7 / R11 item 3: ports the file-first "zero missing files" total gate needs
 * that neither F40 (event bus) nor F41 (seven-source materializer) had a reason to expose.
 *
 * Kept in their own file rather than added to `application/artifact/ports.ts` or
 * `application/files/review-ports.ts`, the same discipline `review-ports.ts`'s own header
 * states for itself: this is F43's own new concern, not an extension of an existing one.
 *
 * Two concerns, two ports:
 *
 *   1. `SourceRefIndex` -- V10 idempotency. `materializeSource` (F41) has no notion of "has
 *      this exact `(sourceType, sourceRef)` already been materialized, and with what content
 *      hash" -- its own header states `sourceRef` is folded into the artifact `title`, not a
 *      queryable column, and a real `source_ref` column is explicitly deferred follow-up
 *      infra work. Rather than inventing that column here (out of this feature's scope, and a
 *      schema change `feature_list.json` did not ask for), this is a narrow lookup/record
 *      port scoped to exactly the one question V10 needs answered: "was THIS source_ref seen
 *      before, and with which hash/version". A real Postgres-backed implementation is
 *      deferred the same way F41 itself shipped with no infra adapter yet (pure
 *      application-layer, tested against fakes -- issue #74).
 *
 *   2. `MaterializationFailureRepository` -- V9 "物化失败可见". A failed materialization must
 *      not silently vanish (no "business object exists but the file browser shows nothing"
 *      state, R7's own wording) and must not block the business action that triggered it
 *      (R7 "不阻断业务"). So a failure is a DURABLE, findable record with a human-readable
 *      reason and a retry handle -- not a thrown exception the caller is left to swallow
 *      inconsistently at each of the seven call sites.
 */
import type { MaterializationSourceType } from "../../domain/files/materialization-events";
import type { OrgId } from "../../domain/org-id";

/** What V10 needs to decide "same content, do not re-version": the artifact this source_ref
 *  already resolved to, and the hash its current head version was written with. */
export interface SourceRefRecord {
  readonly artifactId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly contentHash: string;
}

export interface SourceRefIndex {
  find(
    orgId: OrgId,
    sourceType: MaterializationSourceType,
    sourceRef: string,
  ): Promise<SourceRefRecord | null>;

  /** Overwrites any prior record for this exact `(orgId, sourceType, sourceRef)` -- there is
   *  only ever ONE current resolution per source_ref (I-5's "同 source_ref 内容未变时不新增
   *  版本" implies the converse too: when it DOES change, the index tracks the new head). */
  record(
    orgId: OrgId,
    sourceType: MaterializationSourceType,
    sourceRef: string,
    entry: SourceRefRecord,
  ): Promise<void>;
}

export const SOURCE_REF_INDEX = Symbol("SourceRefIndex");

export interface MaterializationFailureRecord {
  readonly id: string;
  readonly orgId: OrgId;
  readonly sourceType: MaterializationSourceType;
  readonly sourceRef: string;
  /** Human-readable -- what the file browser's "物化失败，内容未入库" row displays verbatim. */
  readonly reason: string;
  /** Whether the retry affordance (R7's "重试出口") should be offered. Always true today --
   *  every failure this feature raises (missing bytes, store unavailable) is retryable once
   *  the underlying cause is fixed; kept as a field rather than a hardcoded `true` in the UI
   *  so a future genuinely-terminal failure kind does not have to invent a second shape. */
  readonly retryable: boolean;
  readonly occurredAt: string;
  /** Set once a later retry for the same `(sourceType, sourceRef)` succeeds. A resolved
   *  failure stays in the log (audit trail) but no longer counts as an open, visible one. */
  readonly resolvedAt: string | null;
}

export interface NewMaterializationFailure {
  readonly orgId: OrgId;
  readonly sourceType: MaterializationSourceType;
  readonly sourceRef: string;
  readonly reason: string;
  readonly retryable: boolean;
}

export interface MaterializationFailureRepository {
  /** Returns the new failure's id. */
  record(f: NewMaterializationFailure): Promise<string>;

  /** The open (unresolved) failure for this source_ref, if any -- what a retry call checks
   *  before deciding whether it has anything to resolve. */
  findOpen(
    orgId: OrgId,
    sourceType: MaterializationSourceType,
    sourceRef: string,
  ): Promise<MaterializationFailureRecord | null>;

  /** Marks a failure resolved (a retry succeeded). Never deletes the row -- R7's visibility
   *  requirement is about the CURRENT state, not about erasing that a failure ever occurred. */
  resolve(orgId: OrgId, failureId: string): Promise<void>;

  /** Every currently-open failure for the org -- what the file browser's cross-cutting
   *  "物化失败" list reads (R7: findable at "对应位置", not only per-object). */
  listOpen(orgId: OrgId): Promise<readonly MaterializationFailureRecord[]>;
}

export const MATERIALIZATION_FAILURE_REPOSITORY = Symbol("MaterializationFailureRepository");
