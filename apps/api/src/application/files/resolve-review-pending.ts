/**
 * F39 -- resolveReviewPending: the reviewer-facing use case `ingestion-worker.ts` (F36) named
 * and deliberately left undone. Its own comment on the `REVIEW_PENDING` branch of
 * `decideNextStep` says so verbatim: the worker must NOT auto-advance a REVIEW_PENDING job to
 * READY the instant it is created (that would auto-approve every review, exactly what R3 step
 * 11 forbids) -- "`resolveReviewPending` (out of this feature's scope -- the reviewer-facing
 * use case) is what enqueues the READY step once a human actually accepts." This module is
 * that function.
 *
 * ## Why accept drives the job to completion itself, rather than only enqueueing
 *
 * `resolveReviewPending.out.state` is `"READY" | "rejected"` -- a reviewer clicking [接受]
 * expects the version to BE `READY` in the response, not "eventually, whenever a poll loop
 * next ticks". `replayIngestionRun` (F36) already established the precedent for bypassing the
 * poll loop's own pacing on an explicit human action (`claimForVersion`, not `claimNext`'s
 * staleness window); this reuses exactly that port method, then calls `completeAndAdvance`
 * itself instead of handing the claimed job to `runIngestionWorkerTick`'s generic step-runner
 * (there is no step-specific WORK left to do for a "READY" job -- the state transition IS the
 * whole of it, same as `ingestion-worker.ts`'s own `runStep` no-oping for every step it does
 * not own).
 *
 * ## Reject does not touch the outbox at all
 *
 * A rejected artifact stays `REVIEW_PENDING` forever -- which is already the one ingestion
 * state `ingestion-visibility.ts`'s `RETRIEVABLE_STATES` excludes, so "rejected ⇒ never
 * recalled" holds without inventing a new terminal ingestion status the closed
 * `IngestionStatus` enum (and its migration CHECK) would have to grow a member for. The
 * DISTINCT, durable fact that this is a REJECTION rather than an still-open review is the
 * `ReviewDispositionRepository` row this function writes either way -- `state: "rejected"` in
 * the response is that row's decision, read back, not a status this reaches into
 * `artifacts.ingestion_status` to set.
 */
import type { IdFactory } from "../artifact/ports";
import type { IngestionOutboxRepository } from "./ingestion-ports";
import type { ProvenanceWriter } from "../provenance/ports";
import type { ReviewDispositionRepository } from "./review-ports";
import type { OrgId } from "../../domain/org-id";

/** Mirrors `apps/web/components/files/review-panel.tsx`'s `canResolve` (≥4 字，写入审计) --
 *  single source of truth for the rule, not two copies that could drift (that UI's 4 is a
 *  courtesy early check; this is the server-side one that actually gates the write). */
export const MIN_NOTE_LENGTH = 4;

export class ArtifactNotFoundError extends Error {}

/** Maps to the contract's `REVIEW_REQUIRED`: nothing outstanding to resolve for this version
 *  (never reached REVIEW_PENDING, already resolved, or already advanced some other way). */
export class ReviewNotRequiredError extends Error {}

/** Maps to the contract's `PROVENANCE_MISSING`: a disposition without a note is an audit
 *  event this feature refuses to write incomplete (R8 "处置意见...写入审计"). */
export class ReviewNoteRequiredError extends Error {}

export interface ResolveReviewPendingInput {
  readonly orgId: OrgId;
  readonly artifactId: string;
  readonly artifactVersionId: string;
  readonly decision: "accept" | "reject";
  readonly note: string;
  readonly actorId: string;
}

export interface ResolveReviewPendingDeps {
  readonly outbox: IngestionOutboxRepository;
  readonly dispositions: ReviewDispositionRepository;
  readonly provenance: ProvenanceWriter;
  readonly ids: IdFactory;
}

export interface ResolveReviewPendingResult {
  readonly state: "READY" | "rejected";
  readonly provenanceEventId: string;
}

export async function resolveReviewPending(
  deps: ResolveReviewPendingDeps,
  input: ResolveReviewPendingInput,
): Promise<ResolveReviewPendingResult> {
  if (input.note.trim().length < MIN_NOTE_LENGTH) {
    throw new ReviewNoteRequiredError("处置理由至少 4 字（写入审计）");
  }

  const existing = await deps.dispositions.find(input.orgId, input.artifactId);
  if (existing !== null) {
    throw new ReviewNotRequiredError(`artifact ${input.artifactId} already resolved (${existing.decision})`);
  }

  const pending = await deps.outbox.findByVersion(input.orgId, input.artifactVersionId);
  if (pending === null || pending.step !== "REVIEW_PENDING") {
    throw new ReviewNotRequiredError(`artifact ${input.artifactId} is not awaiting review`);
  }

  await deps.dispositions.record({
    orgId: input.orgId,
    artifactId: input.artifactId,
    decision: input.decision,
    note: input.note,
    actorId: input.actorId,
  });

  const provenanceEventId = await deps.provenance.append({
    orgId: input.orgId,
    type: input.decision === "accept" ? "review-accepted" : "review-rejected",
    actorId: input.actorId,
    target: { kind: "artifact", id: input.artifactId },
    detail: { note: input.note, artifactVersionId: input.artifactVersionId },
  });

  if (input.decision === "reject") {
    // ⚠ Deliberately does not touch the outbox: the REVIEW_PENDING marker job (enqueued by
    // `ingestion-worker.ts`'s own INDEXED→REVIEW_PENDING fork) is left exactly where it is.
    // A rejected artifact stays `REVIEW_PENDING` forever, which `ingestion-visibility.ts`'s
    // `RETRIEVABLE_STATES` already excludes -- "rejected ⇒ never recalled" holds without a
    // second write here.
    return { state: "rejected", provenanceEventId };
  }

  // Accept: claim the SAME marker job (the one `findByVersion` just read) rather than
  // enqueueing a second one -- reusing it is what keeps `findByVersion` answering "nothing
  // outstanding" afterwards without a leftover row. Driven through TWO `completeAndAdvance`
  // calls, replaying exactly the two steps `ingestion-worker.ts`'s own `decideNextStep` would
  // have taken had a human already said yes at the moment INDEXED forked: first record that
  // the version genuinely sat in `REVIEW_PENDING` (history fidelity -- V2 needs every state
  // that occurred to be visible, and skipping this write would silently erase that this
  // version was ever there), THEN enqueue-and-immediately-complete the `READY` step.
  const claimed = await deps.outbox.claimForVersion(
    input.orgId,
    input.artifactVersionId,
    `review-accept:${input.actorId}`,
  );
  if (claimed !== null) {
    await deps.outbox.completeAndAdvance(input.orgId, claimed.id, "REVIEW_PENDING", "READY");
    const readyJob = await deps.outbox.claimForVersion(
      input.orgId,
      input.artifactVersionId,
      `review-accept:${input.actorId}`,
    );
    if (readyJob !== null) {
      await deps.outbox.completeAndAdvance(input.orgId, readyJob.id, "READY", null);
    }
  }

  return { state: "READY", provenanceEventId };
}
