/**
 * `listSelectableModels` (F50 — **可选范围过滤器，唯一实现，三处复用**: agent / skill /
 * blueprint-policy all call this same use case, never their own filter).
 *
 * The filtering rule itself lives in `../../domain/model/selectable.ts`
 * (`selectableModels`); this file is only the repository round-trip. `consumer` is accepted
 * and threaded through even though the current rule does not vary by it — usecases.md notes
 * this is a "唯一实现" precisely so a FUTURE per-consumer difference (e.g. a blueprint policy
 * one day excluding models still in a probation window) has one function to change, not
 * three call sites to keep in sync.
 */
import type { ModelConsumer, ModelPurpose } from "../../domain/model/registry";
import { selectableModels, type SelectableCandidateRow } from "../../domain/model/selectable";

/** What a listing repository must be able to hand back for the filter to run. */
export interface SelectablePoolReader {
  listCandidates(orgId: string): Promise<readonly SelectableCandidateRow[]>;
}

export async function listSelectableModels(
  orgId: string,
  /** Threaded through, not yet branched on — see header. */
  _consumer: ModelConsumer,
  purpose: ModelPurpose | null,
  pool: SelectablePoolReader,
): Promise<readonly SelectableCandidateRow[]> {
  const rows = await pool.listCandidates(orgId);
  return selectableModels(rows, purpose);
}
