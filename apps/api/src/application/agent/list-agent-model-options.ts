/**
 * F56 -- the agent-side model dropdown (UC-4.1 R3 步骤 4 / AC5).
 *
 * ⚠ This is NOT a second filter. `listSelectableModels` (F50,
 * `application/model/list-selectable-models.ts`) is the bundle's own "唯一实现，三处复用"
 * for exactly this question -- agent / skill / blueprint-policy all consume it. Writing an
 * agent-specific candidate filter here (even one that happens to compute the same answer)
 * would be the sixth instance of "the same fact declared twice" AGENTS.md warns about, this
 * time on a security-relevant surface: a model that fails admission but is reachable through
 * a second, slightly different query is exactly how `MODEL_NOT_SELECTABLE` gets bypassed.
 *
 * This file's only job is to fix `consumer: "agent"` so callers cannot forget it.
 */
import { listSelectableModels, type SelectablePoolReader } from "../model/list-selectable-models";
import type { ModelPurpose } from "../../domain/model/registry";
import type { SelectableCandidateRow } from "../../domain/model/selectable";

export async function listAgentModelOptions(
  orgId: string,
  purpose: ModelPurpose | null,
  pool: SelectablePoolReader,
): Promise<readonly SelectableCandidateRow[]> {
  return listSelectableModels(orgId, "agent", purpose, pool);
}
