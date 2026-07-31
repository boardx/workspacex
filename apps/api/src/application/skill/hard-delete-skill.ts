/**
 * 硬删（F66；契约 `hardDeleteSkill`，UC-3.4 R3 分支 B 步骤 8、R6 AC3）。
 *
 * **只有失败出口的用例**——契约 `out: z.never()`。本用例的返回类型同样没有
 * 「成功」的分支：删除永远走 `evaluateHardDelete`（`reference-enumeration.ts`），
 * 该函数的签名上就没有「允许」这个返回值。
 *
 * ⚠ 拒绝前**先枚举一次引用**——即使结果注定是拒绝，R6 AC3 仍要求「返回引用清单」，
 *   调用方（界面）需要它来告诉维护者「你以为没人用，其实还有这些」。
 */
import { evaluateHardDelete, type HardDeleteVerdict } from "../../domain/skill/reference-enumeration";
import { listReferences } from "./list-references";
import type { ReferenceEnumerationPort, ReferenceSnapshotStorePort, SkillSourcePort } from "./ports";

export interface HardDeleteSkillInput {
  readonly skillId: string;
  readonly newSnapshotId: () => string;
}

export type HardDeleteSkillResult =
  | ({ readonly ok: false } & HardDeleteVerdict)
  | { readonly ok: false; readonly code: "SKILL_NOT_FOUND" };

export async function hardDeleteSkill(
  input: HardDeleteSkillInput,
  deps: {
    readonly enumeration: ReferenceEnumerationPort;
    readonly snapshots: ReferenceSnapshotStorePort;
    readonly source: SkillSourcePort;
  },
): Promise<HardDeleteSkillResult> {
  const source = await deps.source.sourceOf(input.skillId);
  if (source === null) return { ok: false, code: "SKILL_NOT_FOUND" };

  const references = await listReferences(
    { skillId: input.skillId, newSnapshotId: input.newSnapshotId },
    { enumeration: deps.enumeration, snapshots: deps.snapshots },
  );

  const verdict = evaluateHardDelete({ source, references });
  return { ok: false, ...verdict };
}
