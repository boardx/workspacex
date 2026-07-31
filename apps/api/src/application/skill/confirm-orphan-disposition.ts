/**
 * A3/E-孤立绑定：逐条处置——迁到别的环节，或删除（F64）。
 *
 * 依据：契约 `confirmOrphanDisposition`；domain.md I-26；usecases.md
 * 「⚠ 逐条处置，**没有『全部忽略』这个动作**——那正是静默丢弃的另一种写法」。
 *
 * ⚠ **覆盖度校验先于任何写入**：`danglingBindings` 算出此刻已经悬空的绑定，
 *   裁决集合必须**恰好覆盖**它们（多给不算漏，少给即 `ORPHAN_BINDING_UNRESOLVED`
 *   且**零写入**）。这就是「没有被静默丢弃」的机械落点——漏一条，整批都不写。
 */
import {
  applyBindingDispositions,
  danglingBindings,
  type BindingDisposition,
} from "../../domain/skill/orchestration";
import type { SkillErrorCode } from "../../domain/skill/declarative-contract";
import type { ProjectOrchestrationStorePort } from "./ports";

export interface ConfirmOrphanDispositionInput {
  readonly projectId: string;
  readonly dispositions: readonly BindingDisposition[];
}

export type ConfirmOrphanDispositionResult =
  | { readonly ok: true; readonly applied: number }
  | { readonly ok: false; readonly code: SkillErrorCode; readonly reason: string };

export interface ConfirmOrphanDispositionDeps {
  readonly orchestrations: ProjectOrchestrationStorePort;
}

export async function confirmOrphanDisposition(
  input: ConfirmOrphanDispositionInput,
  deps: ConfirmOrphanDispositionDeps,
): Promise<ConfirmOrphanDispositionResult> {
  const orchestration = await deps.orchestrations.load(input.projectId);
  if (orchestration === null) {
    return { ok: false, code: "DEPENDENCY_UNAVAILABLE", reason: "该项目尚无编排" };
  }

  const dangling = danglingBindings(orchestration);
  const coveredIds = new Set(input.dispositions.map((d) => d.bindingId));
  const missing = dangling.filter((b) => !coveredIds.has(b.bindingId));
  if (missing.length > 0) {
    return {
      ok: false,
      code: "ORPHAN_BINDING_UNRESOLVED",
      reason: `${missing.length} 条悬空绑定未裁决：${missing.map((b) => b.bindingId).join(", ")}`,
    };
  }

  // 迁移目标必须是当前仍存在的环节——迁到一个不存在的环节等于换了个写法的静默丢弃。
  const liveSegmentIds = new Set(orchestration.segments.map((s) => s.agendaSegmentId));
  const badMigration = input.dispositions.find(
    (d) => d.action === "migrate" && (d.toAgendaSegmentId === null || !liveSegmentIds.has(d.toAgendaSegmentId)),
  );
  if (badMigration !== undefined) {
    return {
      ok: false,
      code: "ORPHAN_BINDING_UNRESOLVED",
      reason: `绑定 ${badMigration.bindingId} 的迁移目标环节不存在或未指定`,
    };
  }

  const dangledCovered = input.dispositions.filter((d) =>
    dangling.some((b) => b.bindingId === d.bindingId),
  );
  const next = applyBindingDispositions(orchestration, input.dispositions);
  await deps.orchestrations.save(next);
  return { ok: true, applied: dangledCovered.length };
}
