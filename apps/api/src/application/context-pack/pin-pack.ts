/**
 * `PinContextPack` (F13) -- 随定版固化 (I-7).
 *
 * ## What "固化" means here, and why it is mostly NOT this file
 *
 * The naive reading is "copy the pack somewhere it cannot be edited". That is a copy, and a
 * copy is a second place the same fact lives -- the failure this repository has recorded five
 * times. What is actually required by I-7 is narrower and stronger:
 *
 *   the pack of a pinned run must not change when upstream material changes.
 *
 * That property comes for free from the recording model (`recorded-run.ts`): a replay reads
 * the frozen inputs, never `segment_text`, so editing an original cannot move it. What this
 * file adds is the part that recording does not give you -- **the inputs must stop being
 * editable at all** once something has been pinned to them. That is migration 0016's trigger,
 * not TypeScript: an application-level rule is one repository method away from being false,
 * and the row it protects is the evidence behind a decision.
 *
 * So the flow here is: check the target really is a snapshot, replay to get the authoritative
 * item count and digest, and write the pin. The immutability is asserted against the DATABASE
 * in `context-pack-pinned-replay.test.ts`, by trying to edit a pinned run's recording as the
 * runtime role.
 *
 * ## `PIN_REQUIRES_SNAPSHOT` is F07's judgement, imported
 *
 * See `ports.PinRequiresSnapshotError`. Read literally the refusal is unreachable, because an
 * `artifact_versions` row IS an immutable snapshot; eligibility is a property of the binding.
 * That divergence was found, reported and implemented by F07, and re-deriving it here would
 * give the same question two answers.
 */
import { contextPack as CP } from "@repo/contracts";
import type { z } from "zod";
import { judgeCitation } from "../../domain/artifact/downstream-eligibility";
import type { OrgId } from "../../domain/org-id";
import { packContentHash } from "../../domain/context-pack/pack-hash";
import type { ArtifactRepository } from "../artifact/ports";
import type { BindingRepository } from "../artifact/binding-ports";
import { RunNotFoundError } from "./list-omissions";
import { PinRequiresSnapshotError, type ContextPackStore } from "./ports";
import { assembleFromRecorded } from "./replay-pack";

export type PinOut = z.infer<typeof CP.operations.pinContextPack.out>;

export interface PinDeps {
  readonly store: ContextPackStore;
  readonly artifacts: ArtifactRepository;
  readonly bindings: BindingRepository;
}

export interface PinInput {
  readonly runId: string;
  readonly orgId: OrgId;
  readonly artifactVersionId: string;
}

/**
 * Freeze this run's reference list onto a pinned snapshot.
 *
 * ⚠ The `snapshotId` is the artifact version's own id, not a new identifier. A fresh id would
 * be a second name for one snapshot, and V8's question -- "take any pinned conclusion, restore
 * the reference list it had" -- starts from the version the reader is looking at. Making them
 * ask a lookup table to translate is how the two drift apart.
 */
export async function pinContextPack(deps: PinDeps, input: PinInput): Promise<PinOut> {
  const row = await deps.store.findRecorded(input.runId);
  if (row === null) throw new RunNotFoundError(input.runId);

  // Order: the target is validated BEFORE anything is written, so a refused pin leaves no
  // trace. A run half-pinned to an ineligible version would satisfy the write-once trigger
  // and permanently block the correct pin.
  const version = await deps.artifacts.findVersion(input.orgId, input.artifactVersionId);
  if (version === null) {
    // Deliberately the same shape as "not pinned": under RLS a version in another tenant is
    // invisible, and a distinguishable refusal turns this endpoint into an oracle for ids.
    throw new PinRequiresSnapshotError(input.artifactVersionId, "no such version in this tenant");
  }
  const anchors = await deps.bindings.findAnchorsForArtifact(input.orgId, version.artifactId);
  const verdict = judgeCitation(input.artifactVersionId, anchors);
  if (!verdict.eligible) {
    throw new PinRequiresSnapshotError(
      input.artifactVersionId,
      `${verdict.reason}: no binding pins this version, so it is live/draft/unbound and a ` +
        `context pack frozen to it would follow the source forward`,
    );
  }

  // Replayed rather than read: the item count written into the pin has to be the count the
  // audit path will produce, and the only way to guarantee that is to produce it the same way.
  const pack = assembleFromRecorded(row.run, input.artifactVersionId);
  const contentHash = packContentHash(pack);

  await deps.store.pin({
    runId: input.runId,
    snapshotId: input.artifactVersionId,
    artifactVersionId: input.artifactVersionId,
    contentHash,
    frozenItemCount: pack.items.length,
  });

  return { snapshotId: input.artifactVersionId, contentHash, frozenItemCount: pack.items.length };
}
