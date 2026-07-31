/**
 * A3/E-孤立绑定：切模板或删环节前，先列出将丢失的绑定与分工（F64）。
 *
 * 依据：契约 `previewOrphanBindings`（**纯读，零写入**）；
 *       domain.md I-26「切模板/删环节断言先返回『将丢失的绑定与分工』清单，
 *       未确认前零写入」；usecases.md「没有绑定条目被静默丢弃（AC6/V6）」。
 *
 * ⚠ 本用例**只读** `orchestrations.load`，从不调用 `save`——这不是一条纪律，
 *   是这个函数体里字面上没有任何写调用。
 */
import { previewOrphanImpact, type OrphanChange } from "../../domain/skill/orchestration";
import type { SegmentBinding } from "../../domain/skill/binding-slot";
import type { SkillErrorCode } from "../../domain/skill/declarative-contract";
import type { ProjectOrchestrationStorePort } from "./ports";

export interface PreviewOrphanBindingsInput {
  readonly projectId: string;
  readonly changeKind: "switch-template" | "remove-segment";
  /** `switch-template` 时是目标 workflowTemplateId（本用例不需要读它，仅记账用）；
   *  `remove-segment` 时是待删的 agendaSegmentId。 */
  readonly targetId: string;
}

export interface RoleCellRefLite {
  readonly agendaSegmentId: string;
  readonly roleKey: string;
}

export type PreviewOrphanBindingsResult =
  | {
      readonly ok: true;
      readonly lostBindings: readonly SegmentBinding[];
      readonly lostRoleCells: readonly RoleCellRefLite[];
    }
  | { readonly ok: false; readonly code: SkillErrorCode; readonly reason: string };

export interface PreviewOrphanBindingsDeps {
  readonly orchestrations: ProjectOrchestrationStorePort;
}

export async function previewOrphanBindings(
  input: PreviewOrphanBindingsInput,
  deps: PreviewOrphanBindingsDeps,
): Promise<PreviewOrphanBindingsResult> {
  const orchestration = await deps.orchestrations.load(input.projectId);
  if (orchestration === null) {
    return { ok: false, code: "DEPENDENCY_UNAVAILABLE", reason: "该项目尚无编排，无孤立绑定可预览" };
  }

  const change: OrphanChange =
    input.changeKind === "switch-template"
      ? { kind: "switch-template" }
      : { kind: "remove-segment", agendaSegmentId: input.targetId };

  const { lostBindings, lostRoleCells } = previewOrphanImpact(orchestration, change);
  return {
    ok: true,
    lostBindings,
    lostRoleCells: lostRoleCells.map((c) => ({ agendaSegmentId: c.agendaSegmentId, roleKey: c.role })),
  };
}
