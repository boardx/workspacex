/**
 * `listModelReferences` (F50 — 停用前的引用枚举). "无清单不得停用": `disableModel` refuses
 * to run without a `referenceSnapshotId` this use case minted, so an admin cannot confirm a
 * disable against a list they never actually saw.
 *
 * Nothing here decides anything — it is a straight pass-through to `ModelReferenceReader`.
 * It exists as its own use case (rather than folding the read into `disableModel`) because
 * it is its own contract operation (`agent-runtime.ts` `listModelReferences`) with its own
 * caller: the confirm dialog fetches this BEFORE the admin picks a mode, `disableModel`
 * fetches it again only to re-derive the cascade.
 */
import type { ModelReferenceReader } from "./ports";

export interface ModelReferenceSnapshot {
  readonly referenceSnapshotId: string;
  readonly agents: readonly string[];
  readonly skills: readonly string[];
  readonly blueprintPolicies: readonly string[];
  readonly activeProjects: readonly string[];
  readonly inFlightCalls: number;
}

export async function listModelReferences(
  orgId: string,
  modelId: string,
  references: ModelReferenceReader,
): Promise<ModelReferenceSnapshot> {
  return references.snapshot(orgId, modelId);
}
