/**
 * `disableModel` (F50 / uc-20-2 R3 步骤 3–4, invariants I-5 I-16, D-U5).
 *
 * Orchestrates three things the domain layer (`../../domain/model/disable.ts`) does not
 * know how to do, because none of them are decisions:
 *   1. optimistic concurrency — `expectedVersion` and `referenceSnapshotId` must both still
 *      match what is stored, or the admin confirmed against a world that has moved on;
 *   2. asking `evaluateDisableCascade` the one decision that IS a decision (refuse, or go);
 *   3. writing the result — the row itself, every dependent's `依赖失败` flag, and the
 *      actual in-flight-call policy.
 *
 * ## Why the affected ids and the interrupted-call count come from different places
 *
 * `affectedAgentIds` / `affectedSkillIds` / `affectedProjectIds` come from the SNAPSHOT read
 * moments ago (`listModelReferences`, which is what the confirm dialog showed the admin).
 * `interruptedCalls` comes from `writer.applyCallPolicy`'s return value, not from the
 * snapshot's `inFlightCalls` — some of those calls may have finished on their own between
 * the snapshot and this write, and reporting the STALE count as what was interrupted would
 * be a second, silent claim about what actually happened.
 *
 * ⚠ `MODEL_NOT_FOUND` is not one of `disableModel.err`'s four contract codes, same situation
 * as `enable-model.ts`'s constant of the same name (imported from there rather than
 * re-declared — one name for one fact). See that file's comment for why it is not mapped
 * onto a contract code here either.
 */
import {
  evaluateDisableCascade,
  LAST_SELF_HOSTED_MODEL,
  type ModelReferenceSnapshot,
} from "../../domain/model/disable";
import type { DisableMode } from "../../domain/model/registry";
import { MODEL_NOT_FOUND } from "./enable-model";
import type { ModelDisableWriter, ModelKindStatusReader, ModelReferenceReader } from "./ports";

export const VERSION_CHANGED = "VERSION_CHANGED" as const;

export interface DisableModelInput {
  readonly modelId: string;
  readonly referenceSnapshotId: string;
  readonly mode: DisableMode;
  readonly reason: string;
  readonly expectedVersion: string;
}

export type DisableModelResult =
  | {
      readonly ok: true;
      readonly disabled: true;
      readonly affectedAgentIds: readonly string[];
      readonly affectedSkillIds: readonly string[];
      readonly affectedProjectIds: readonly string[];
      readonly interruptedCalls: number;
    }
  | {
      readonly ok: false;
      readonly code: typeof MODEL_NOT_FOUND | typeof VERSION_CHANGED | typeof LAST_SELF_HOSTED_MODEL;
    };

export interface DisableModelDeps {
  readonly models: ModelKindStatusReader;
  readonly references: ModelReferenceReader;
  readonly writer: ModelDisableWriter;
}

export async function disableModel(
  orgId: string,
  input: DisableModelInput,
  deps: DisableModelDeps,
): Promise<DisableModelResult> {
  const model = await deps.models.read(orgId, input.modelId);
  if (model === null) return { ok: false, code: MODEL_NOT_FOUND };

  // ⚠ Two independent staleness checks, and either one alone is not enough: the row could
  // have been re-enabled and re-disabled (version moves, reference list happens to repeat)
  // just as easily as the reference list could have changed under an unmoved version.
  if (model.version !== input.expectedVersion) return { ok: false, code: VERSION_CHANGED };

  const snapshot: ModelReferenceSnapshot = await deps.references.snapshot(orgId, input.modelId);
  if (snapshot.referenceSnapshotId !== input.referenceSnapshotId) {
    return { ok: false, code: VERSION_CHANGED };
  }

  const otherSelfHostedEnabled = await deps.models.countOtherEnabledSelfHosted(
    orgId,
    input.modelId,
  );
  const cascade = evaluateDisableCascade(
    { kind: model.kind },
    otherSelfHostedEnabled,
    input.mode,
    snapshot,
  );
  if (!cascade.ok) return { ok: false, code: cascade.code };

  await deps.writer.disable(orgId, input.modelId);
  await deps.writer.markDependencyFailed({
    orgId,
    modelId: input.modelId,
    agentIds: cascade.affectedAgentIds,
    skillIds: cascade.affectedSkillIds,
  });
  // ⚠ Not `cascade.interruptedCalls` — see the header. The writer's return value is what
  // actually happened; the domain result only decided WHETHER disabling was allowed.
  const interruptedCalls = await deps.writer.applyCallPolicy(orgId, input.modelId, input.mode);

  return {
    ok: true,
    disabled: true,
    affectedAgentIds: cascade.affectedAgentIds,
    affectedSkillIds: cascade.affectedSkillIds,
    affectedProjectIds: cascade.affectedProjectIds,
    interruptedCalls,
  };
}
