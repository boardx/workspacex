/**
 * `ResolvePackModelConstraint` + the model picker it constrains (F13, V9 / D-U1 / I-10).
 *
 * ## This use case decides nothing
 *
 * The contract says so in the imperative -- 委托给 `identity.resolveModelConstraint`，不重新判定
 * -- and coherence B-3 / X-5 says why: `source` distinguishes a product PROMISE from an org
 * POLICY, and those differ in whether an administrator can switch them off. Two judging points
 * is how one screen calls it a promise and another calls it a policy. So the whole of this file
 * is: work out this pack's `dataScope`, hand it to identity, pass the answer through.
 *
 * ## The one judgement that IS here: which segments count as confidential
 *
 * `resolvePackModelConstraint`'s input is a runId, so somebody has to turn that into a
 * dataScope, and `ContextItem` carries no confidentiality field at all
 * (`KNOWN_CONTRACT_GAPS.G7`). The answer is the UNION of two sources, and neither alone is
 * safe:
 *
 *   recorded-only -- material RECLASSIFIED as confidential after the run would not confine a
 *                    round that reads it. The classification would be correct in the database
 *                    and ignored by the only code that acts on it.
 *   current-only  -- a `segment_text` row deleted or rebuilt (it is an explicitly rebuildable
 *                    projection, see migration 0009) would silently DOWNGRADE a historical run
 *                    from local-only to cloud-eligible. A projection rebuild is not a
 *                    declassification decision, and it must not be able to act as one.
 *
 * Union, therefore: fail-closed in both directions. Once confidential, always confidential for
 * this run, plus anything that has become confidential since.
 *
 * ⚠ This does NOT contradict I-7. I-7 freezes what the pack CONTAINS. Where that content may
 * be processed is a live question asked at call time, and a frozen answer to it would mean a
 * pinned pack could never be brought under a stricter rule.
 */
import { contextPack as CP } from "@repo/contracts";
import type { z } from "zod";
import {
  confidentialItemCount,
  packDataScope,
  selectableModels,
  type SelectableModel,
} from "../../domain/context-pack/model-routing";
import type { ContextItem } from "../../domain/context-pack/context-item";
import type { OrgId } from "../../domain/org-id";
import { replayContextPack } from "./replay-pack";
import type { ContextPackStore, ModelConstraintPort } from "./ports";

export type PackModelConstraintOut = z.infer<typeof CP.operations.resolvePackModelConstraint.out>;

export interface PackModelDeps {
  readonly store: ContextPackStore;
  readonly constraints: ModelConstraintPort;
}

export interface PackModelInput {
  readonly runId: string;
  readonly orgId: OrgId;
}

/** The union described in the header. Exported so the test can assert each half separately. */
export async function packConfidentialSegmentIds(
  deps: { readonly store: ContextPackStore },
  orgId: OrgId,
  items: readonly ContextItem[],
  recordedConfidential: ReadonlySet<string>,
): Promise<ReadonlySet<string>> {
  const ids = items.map((i) => i.segmentId);
  const now = await deps.store.confidentialNow(orgId, ids);
  return new Set(ids.filter((id) => recordedConfidential.has(id) || now.has(id)));
}

async function scopeOf(
  deps: PackModelDeps,
  input: PackModelInput,
): Promise<{
  readonly items: readonly ContextItem[];
  readonly confidential: ReadonlySet<string>;
  readonly principalId: string;
}> {
  // Through replay, not a separate read: the constraint has to be computed over the SAME
  // items[] the model will be shown. A second path to "what is in this pack" is a second
  // answer, and the one that decides where the data may go must not be the other one.
  const pack = await replayContextPack(deps, { runId: input.runId });
  const row = await deps.store.findRecorded(input.runId);
  const recorded = new Set(
    (row?.run.candidates ?? []).filter((c) => c.confidential).map((c) => c.segmentId),
  );
  const confidential = await packConfidentialSegmentIds(deps, input.orgId, pack.items, recorded);
  return { items: pack.items, confidential, principalId: pack.query.principalId };
}

export async function resolvePackModelConstraint(
  deps: PackModelDeps,
  input: PackModelInput,
): Promise<PackModelConstraintOut> {
  const { items, confidential, principalId } = await scopeOf(deps, input);

  const verdict = await deps.constraints.resolve({
    userId: principalId,
    orgId: input.orgId,
    dataScope: packDataScope(items, confidential),
  });

  // Passed through field for field. Not re-derived, not "adjusted", not defaulted -- the
  // contract's `source` and `reason` are identity's words, and rewriting them here is how the
  // promise/policy distinction gets flattened into "it is off".
  return {
    localOnly: verdict.localOnly,
    source: verdict.source,
    reason: verdict.reason,
    confidentialItemCount: confidentialItemCount(items, confidential),
  };
}

/**
 * V9 proper: **the model picker for this round returns only self-hosted models.**
 *
 * A verdict object is not a routing rule -- F16 makes that argument about `invokeLocalModel`
 * and it applies here verbatim. `resolvePackModelConstraint` returning `localOnly: true` while
 * a cloud model stays selectable is the whole failure this acceptance names.
 */
export async function selectableModelsForPack(
  deps: PackModelDeps,
  input: PackModelInput,
): Promise<{ readonly localOnly: boolean; readonly models: readonly SelectableModel[] }> {
  const constraint = await resolvePackModelConstraint(deps, input);
  const configured = await deps.store.listModels(input.orgId);
  return { localOnly: constraint.localOnly, models: selectableModels(configured, constraint) };
}
