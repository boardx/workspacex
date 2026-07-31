/**
 * A5/V8：未被任何环节绑定的 skill（F64）。
 *
 * 依据：契约 `listIdleSkills`；usecases.md「⚠ 空 ⇒ 真实空态」。
 */
import type { SkillErrorCode } from "../../domain/skill/declarative-contract";
import type { AllOrchestrationsPort, OrgSkillCatalogPort } from "./ports";

export interface ListIdleSkillsInput {
  readonly orgId: string;
}

export type ListIdleSkillsResult =
  | { readonly ok: true; readonly idle: readonly string[] }
  | { readonly ok: false; readonly code: SkillErrorCode; readonly reason: string };

export interface ListIdleSkillsDeps {
  readonly catalog: OrgSkillCatalogPort;
  readonly bound: AllOrchestrationsPort;
}

export async function listIdleSkills(
  input: ListIdleSkillsInput,
  deps: ListIdleSkillsDeps,
): Promise<ListIdleSkillsResult> {
  const [all, bound] = await Promise.all([
    deps.catalog.listEnabled(input.orgId),
    deps.bound.boundSkillIds(input.orgId),
  ]);
  const boundSet = new Set(bound);
  return { ok: true, idle: all.filter((id) => !boundSet.has(id)) };
}
