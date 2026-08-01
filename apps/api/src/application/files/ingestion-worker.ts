/**
 * F36 -- the worker half of the transactional outbox (uc-22-2 R8, architecture 第三节).
 *
 * ## The shape of one tick
 *
 * `runIngestionWorkerTick` claims AT MOST ONE job, does that job's step-specific work, then
 * calls `completeAndAdvance` -- which is the ONE place `artifacts.ingestion_status` moves,
 * the history row gets appended, and the NEXT job gets enqueued, all in a single PG
 * transaction (`PgIngestionRepository.completeAndAdvance`).
 *
 * ## Why replay cannot produce a duplicate Segment (V12)
 *
 * The only step with a durable, dedup-sensitive side effect is `SEGMENTED`: it writes rows
 * via `ArtifactRepository.addSegments`, which has NO `ON CONFLICT` (see that port's own
 * comment) -- a second attempt at the same `(artifact_version_id, ordinal)` throws a unique
 * violation on `segments_uniq_ordinal` (0006). This module treats exactly that violation as
 * "this step's effect already landed" and proceeds to `completeAndAdvance` anyway, rather
 * than surfacing it as a failure. That is what makes the following crash scenario safe:
 *
 *   1. worker A claims the SEGMENTED job, writes segment ordinal 0, then dies before
 *      `completeAndAdvance` runs (crash between the segment INSERT's COMMIT and the next).
 *   2. the job's `locked_at` is now stale; `claimNext` lets ANY worker (including a
 *      restarted A) reclaim it -- that reclaim IS `replayIngestionRun` (uc-22-2 V12).
 *   3. the replay re-runs the SEGMENTED step: `addSegments` throws the unique violation,
 *      this module catches exactly that error and continues, and `completeAndAdvance` runs
 *      for the first time -- the version advances, and there is still exactly one segment.
 *
 * No idempotency KEY table is needed for this because the natural key already IS the unique
 * constraint the segment's own identity is defined by (`artifact_version_id, ordinal`) --
 * inventing a second one would be redeclaring that fact a second place.
 */
import { ObjectExistsError, type ArtifactRepository, type IdFactory, type NewSegment, type ObjectStore } from "../artifact/ports";
import { legalNextStates } from "../../domain/files/ingestion-pipeline";
import { runExtractionAdapter } from "../../domain/files/extraction-adapters";
import type { IngestionOutboxRepository, IngestionStep } from "./ingestion-ports";
import type { OrgId } from "../../domain/org-id";

export interface IngestionWorkerDeps {
  readonly outbox: IngestionOutboxRepository;
  readonly artifacts: ArtifactRepository;
  readonly ids: IdFactory;
  /**
   * F37 -- lets `runStep` fetch a version's actual bytes and run the four extraction
   * adapters (`domain/files/extraction-adapters.ts`) for real, instead of the placeholder
   * single-segment stub F36 shipped with. Optional and defaulted to the OLD stub behaviour
   * when absent, so every caller that predates F37 (both of this file's existing PG-backed
   * tests construct `IngestionWorkerDeps` without a `store`) keeps compiling and behaving
   * exactly as before -- adding a mandatory dependency here would be a breaking change to an
   * already-merged, already-passing feature for no reason internal to this one.
   */
  readonly store?: ObjectStore;
}

/**
 * Decides whether a version needs human review before `READY` (uc-22-2 R3 step 11:
 * confidential ∨ PII five-class ∨ low parse quality, O-39). The threshold/PII detector
 * itself is `contracts/files/design-signoff.md` T-9 -- explicitly UNDECIDED ("阈值数值
 * [待定 T-9]") -- so this is a PORT, not a hardcoded predicate: this feature does not
 * invent the number, it gives the fork a place to plug into once T-9 is ratified. The
 * default below is the conservative structural stand-in ("nothing routes to review yet")
 * that keeps the fork itself real without asserting an undecided threshold.
 */
export interface ReviewGate {
  needsReview(input: { readonly orgId: OrgId; readonly artifactVersionId: string }): Promise<boolean>;
}

export const NEVER_NEEDS_REVIEW: ReviewGate = { needsReview: async () => false };

/** Claimed a job whose `attempts` guard-rail was blown: not silently retried forever. */
export const MAX_ATTEMPTS = 5;

export type IngestionTickResult =
  | { readonly claimed: false }
  | { readonly claimed: true; readonly step: IngestionStep; readonly artifactVersionId: string };

/**
 * One tick for one org. A process serving many orgs calls this once per known `orgId` on
 * its poll loop -- see `IngestionOutboxRepository.claimNext`'s own comment for why this is
 * tenant-scoped rather than a single cross-tenant claim.
 */
export async function runIngestionWorkerTick(
  deps: IngestionWorkerDeps,
  orgId: OrgId,
  workerId: string,
  reviewGate: ReviewGate = NEVER_NEEDS_REVIEW,
  staleAfterMs = 5 * 60 * 1000,
): Promise<IngestionTickResult> {
  const job = await deps.outbox.claimNext(orgId, workerId, staleAfterMs);
  if (job === null) return { claimed: false };
  return processClaimedJob(deps, orgId, job, reviewGate);
}

/**
 * Explicit replay/retry of ONE version's job (uc-22-2 V12) -- `replayIngestionRun` /
 * `retryIngestionStep`, as opposed to the poll loop's `runIngestionWorkerTick`. Claims
 * regardless of staleness (`claimForVersion`, not `claimNext`) because a human clicking
 * [重试] is not waiting for a staleness window to elapse. Returns `{ claimed: false }` when
 * there is no outstanding job for that version (e.g. it already reached `READY`).
 */
export async function replayIngestionRun(
  deps: IngestionWorkerDeps,
  orgId: OrgId,
  artifactVersionId: string,
  workerId: string,
  reviewGate: ReviewGate = NEVER_NEEDS_REVIEW,
): Promise<IngestionTickResult> {
  const job = await deps.outbox.claimForVersion(orgId, artifactVersionId, workerId);
  if (job === null) return { claimed: false };
  return processClaimedJob(deps, orgId, job, reviewGate);
}

async function processClaimedJob(
  deps: IngestionWorkerDeps,
  orgId: OrgId,
  job: { readonly id: string; readonly orgId: OrgId; readonly artifactVersionId: string; readonly step: IngestionStep; readonly attempts: number },
  reviewGate: ReviewGate,
): Promise<IngestionTickResult> {
  if (job.attempts > MAX_ATTEMPTS) {
    await deps.outbox.markFailed(orgId, job.id, `giving up after ${job.attempts} attempts`);
    return { claimed: true, step: job.step, artifactVersionId: job.artifactVersionId };
  }

  try {
    await runStep(deps, job.orgId, job.artifactVersionId, job.step);
  } catch (e) {
    await deps.outbox.markFailed(orgId, job.id, e instanceof Error ? e.message : String(e));
    return { claimed: true, step: job.step, artifactVersionId: job.artifactVersionId };
  }

  const nextStep = await decideNextStep(job.step, job.orgId, job.artifactVersionId, reviewGate);
  await deps.outbox.completeAndAdvance(orgId, job.id, job.step, nextStep);
  return { claimed: true, step: job.step, artifactVersionId: job.artifactVersionId };
}

/**
 * The step's actual work. `ENRICHED` has no durable side effect this feature owns (embedding
 * generation is a later feature's body to fill in -- this module owns the STATE MACHINE, not
 * the NLP); `EXTRACTED`/`SEGMENTED` are F37's two (the four adapters' derived file, and the
 * segments/anchors they produce), and `INDEXED` is a pure transition (the fork happens in
 * `decideNextStep`, not here, so it is asserted once rather than duplicated between the two
 * functions).
 */
async function runStep(
  deps: IngestionWorkerDeps,
  orgId: OrgId,
  artifactVersionId: string,
  step: IngestionStep,
): Promise<void> {
  if (step === "EXTRACTED") return runExtractedStep(deps, orgId, artifactVersionId);
  if (step === "SEGMENTED") return runSegmentedStep(deps, orgId, artifactVersionId);
}

/**
 * F37 -- fetches the version's real bytes and runs one of the four extraction adapters
 * (`domain/files/extraction-adapters.ts`), materializing its output as an independent
 * derived file (`derived_representations`, never overwriting the original -- I-6).
 *
 * Without `deps.store` this is a no-op, same as F36 shipped it (see `IngestionWorkerDeps`'s
 * own comment) -- there is no legacy behaviour to preserve here beyond "do nothing", since
 * F36 never gave this step a body.
 *
 * ## Replay-safety, the same technique as `SEGMENTED`'s but one level up
 *
 * The object key is namespaced by `(artifactVersionId, adapter kind)` ONLY -- no random
 * per-attempt id folded in (contrast `createDerivedRepresentation`, which folds in a fresh
 * `derivedId` specifically so a RERUN of OCR produces a second row, A4). A replay of THIS
 * step is not a rerun; it is the same worker re-attempting the same extraction of the same
 * bytes, and a second `putOnce` at the same stable key throws `ObjectExistsError`, which this
 * function treats as "already applied" -- the same "unique-violation-means-replay" reading
 * `isSegmentOrdinalConflict` already established for `SEGMENTED`.
 */
async function runExtractedStep(deps: IngestionWorkerDeps, orgId: OrgId, artifactVersionId: string): Promise<void> {
  if (deps.store === undefined) return;

  const version = await deps.artifacts.findVersion(orgId, artifactVersionId);
  if (version === null) return;
  const bytes = await deps.store.get(version.objectStorageKey);
  if (bytes === null) return;

  const extraction = runExtractionAdapter(bytes);
  const key = `${orgId}/derived/${artifactVersionId}/${extraction.derivedKind}/extracted.txt`;

  try {
    await deps.store.putOnce(key, new TextEncoder().encode(extraction.derivedText), "text/plain");
  } catch (e) {
    if (e instanceof ObjectExistsError) return; // replay -- the derived file already landed
    throw e;
  }

  await deps.artifacts.createDerived({
    id: deps.ids.next("drv"),
    orgId,
    derivedFrom: artifactVersionId,
    kind: extraction.derivedKind,
    objectStorageKey: key,
    generatorModel: extraction.generatorModel,
    generatorVersion: extraction.generatorVersion,
    pipelineVersion: "1",
  });
}

/**
 * F37 -- re-runs the SAME adapter (pure and deterministic over the same bytes, so this is
 * not a second declaration of what `runExtractedStep` computed, just the SEGMENTED step
 * recomputing it independently -- these are two different outbox jobs/transactions, and
 * carrying state between them would reintroduce the "worker crashed between two steps"
 * hazard `ingestion-worker.ts`'s header already discusses) and writes one Segment+Anchor
 * per extracted unit, anchored per the adapter's modality (page/image-region/timecode/
 * message-id/question-no -- uc-22-2 R7 "每个 Segment 能回到原件").
 *
 * Falls back to F36's original single hard-coded segment when `deps.store` is absent, which
 * is the exact shape `worker-replay-no-duplicate.test.ts` (F36, already merged) asserts on --
 * this preserves that test's behaviour unchanged rather than risking a regression in an
 * already-passing feature to widen a dependency this feature does not need there.
 */
async function runSegmentedStep(deps: IngestionWorkerDeps, orgId: OrgId, artifactVersionId: string): Promise<void> {
  const segments =
    deps.store === undefined
      ? undefined
      : await planSegmentsFromBytes(deps, deps.store, orgId, artifactVersionId);

  const toWrite =
    segments ?? [
      {
        id: deps.ids.next("seg"),
        artifactVersionId,
        kind: "text" as const,
        ordinal: 0,
        anchors: [{ id: deps.ids.next("anc"), kind: "page" as const, locator: "1" }],
      },
    ];

  try {
    await deps.artifacts.addSegments(orgId, toWrite);
  } catch (e) {
    // See this module's header: a unique violation on `segments_uniq_ordinal` means a
    // REPLAY of this exact step, and the segment it would have written already exists.
    // That is success, not failure -- anything else re-throws.
    if (isSegmentOrdinalConflict(e)) return;
    throw e;
  }
}

async function planSegmentsFromBytes(
  deps: IngestionWorkerDeps,
  store: ObjectStore,
  orgId: OrgId,
  artifactVersionId: string,
): Promise<readonly NewSegment[] | undefined> {
  const version = await deps.artifacts.findVersion(orgId, artifactVersionId);
  if (version === null) return undefined;
  const bytes = await store.get(version.objectStorageKey);
  if (bytes === null) return undefined;

  const extraction = runExtractionAdapter(bytes);
  return extraction.units.map((unit, ordinal) => ({
    id: deps.ids.next("seg"),
    artifactVersionId,
    kind: unit.segmentKind,
    ordinal,
    anchors: [{ id: deps.ids.next("anc"), kind: unit.anchorKind, locator: unit.locator }] as const,
  }));
}

function isSegmentOrdinalConflict(e: unknown): boolean {
  const err = e as { code?: string; constraint?: string };
  return err?.code === "23505" && err?.constraint === "segments_uniq_ordinal";
}

async function decideNextStep(
  completedStep: IngestionStep,
  orgId: OrgId,
  artifactVersionId: string,
  reviewGate: ReviewGate,
): Promise<IngestionStep | null> {
  if (completedStep === "INDEXED") {
    const needsReview = await reviewGate.needsReview({ orgId, artifactVersionId });
    return needsReview ? "REVIEW_PENDING" : "READY";
  }
  if (completedStep === "REVIEW_PENDING") {
    // ⚠ Deliberately NOT `legalNextStates("REVIEW_PENDING")` (which is `["READY"]`). That
    // edge exists in the domain graph because a human WILL eventually move this version to
    // READY, but this worker must not walk it by itself the instant the REVIEW_PENDING job
    // finishes -- that would auto-approve every review the moment it is created, which is
    // precisely what R3 step 11 forbids ("须人接受后才 READY"). `resolveReviewPending`
    // (out of this feature's scope -- the reviewer-facing use case) is what enqueues the
    // `READY` step once a human actually accepts.
    return null;
  }
  const [next] = legalNextStates(completedStep);
  // Every remaining non-terminal step has EXACTLY one legal successor (see
  // `ingestion-pipeline.ts`'s `TRANSITIONS`); `READY` itself falls through to `undefined`
  // here and this returns `null` (nothing left to queue).
  return (next as IngestionStep | undefined) ?? null;
}
