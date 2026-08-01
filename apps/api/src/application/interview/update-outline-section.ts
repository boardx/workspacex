/**
 * `updateOutlineSection` —— 研究员逐段手改大纲（F85，uc-6-2 R3 步骤6，AC1）。
 *
 * ## 局部更新语义——`null` 表示「这个字段不改」
 *
 * 契约 `updateOutlineSection.in` 的 `objective` / `openers` / `minutes` 三个字段都是
 * `nullable`：研究员一次只调时长（`[− 5 分 +]`）时不该被逼着把 `objective`/`openers`
 * 原样传一遍，`null` 就是「这次没碰这个字段」，不是「清空它」。
 *
 * ## 手改之后：`manuallyEdited` 置真，`confirmed` 打回 `pending_confirm`
 *
 * 见 `outline-ports.ts` `updateSections` 的文件头——这条落在仓储层，本函数只负责
 * 拼出补丁后的整份 `sections` 交给它，不重复这条状态机逻辑。
 *
 * ## 并发：段落已经不在了
 *
 * `sections` 整体存成一个 jsonb 数组（无按行并发令牌），`sectionId` 是
 * `${outlineId}-order 派生`的稳定 id（见 `pg-outline-repository.ts` 的 `sec-${order}`）。
 * 若两名研究员之一先重新生成了大纲（`regenerateOutline`），旧的 `sectionId` 可能不复存在——
 * 这里按 `OutlineSectionConcurrentModificationError` 拒绝，而不是把补丁静默套到错的段落上。
 */
import type { OrgId } from "../../domain/org-id";
import type { OutlineSectionDraft } from "../../domain/interview/outline";
import { OutlineSectionConcurrentModificationError } from "./errors";
import type { OutlineRecord, OutlineRepository } from "./outline-ports";

export interface UpdateOutlineSectionDeps {
  readonly outlines: OutlineRepository;
}

export interface UpdateOutlineSectionDto {
  readonly orgId: OrgId;
  readonly outlineId: string;
  readonly sectionId: string;
  /** `null` = 不改这个字段。 */
  readonly objective: string | null;
  readonly openers: readonly string[] | null;
  readonly minutes: number | null;
}

export async function updateOutlineSection(
  deps: UpdateOutlineSectionDeps,
  input: UpdateOutlineSectionDto,
): Promise<OutlineRecord> {
  const current = await deps.outlines.getById(input.orgId, input.outlineId);
  if (current === null) {
    throw new OutlineSectionConcurrentModificationError(input.outlineId, input.sectionId);
  }

  const idx = current.sections.findIndex((s) => s.sectionId === input.sectionId);
  if (idx === -1) {
    throw new OutlineSectionConcurrentModificationError(input.outlineId, input.sectionId);
  }

  const nextSections: OutlineSectionDraft[] = current.sections.map((s, i) => {
    if (i !== idx) {
      return { objective: s.objective, openers: s.openers, minutes: s.minutes, order: s.order };
    }
    return {
      objective: input.objective ?? s.objective,
      openers: input.openers ?? s.openers,
      minutes: input.minutes ?? s.minutes,
      order: s.order,
    };
  });

  return deps.outlines.updateSections(input.orgId, input.outlineId, nextSections);
}
