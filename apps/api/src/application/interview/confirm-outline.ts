/**
 * `confirmOutline` —— 研究员确认大纲（F84 收口 + F85 完整性校验，uc-6-2 R3 步骤3/6/8，AC1/AC5）。
 *
 * 状态从 `pending_confirm` 转 `confirmed` 之后，`startSession` 才可能放行进现场（I-10）。
 * F85 补上 R6 正常后置条件里那句「校验 AC1：大纲每段都有目标与至少两条开场问法」——
 * 仍有缺项时拒绝确认（`OUTLINE_INCOMPLETE`），而不是把「确认」变成一个总是成功的按钮。
 *
 * ⚠ 这条校验不改变 F84 既有测试的结果：`generateOutlineDraft` 产出的草案本身
 *   就满足 AC1（每段都有目标 + 两条开场问法），所以「首次生成即确认」的路径不受影响，
 *   只有经手改后仍缺项的大纲才会在这里被拦下来。
 */
import type { OrgId } from "../../domain/org-id";
import { countIncompleteSections } from "../../domain/interview/outline";
import { OutlineIncompleteError } from "./errors";
import type { OutlineRecord, OutlineRepository } from "./outline-ports";

export interface ConfirmOutlineDeps {
  readonly outlines: OutlineRepository;
}

export interface ConfirmOutlineDto {
  readonly orgId: OrgId;
  readonly outlineId: string;
}

export async function confirmOutline(deps: ConfirmOutlineDeps, input: ConfirmOutlineDto): Promise<OutlineRecord> {
  const current = await deps.outlines.getById(input.orgId, input.outlineId);
  if (current !== null) {
    const incompleteCount = countIncompleteSections(current.sections);
    if (incompleteCount > 0) throw new OutlineIncompleteError(input.outlineId, incompleteCount);
  }
  return deps.outlines.confirm(input.orgId, input.outlineId);
}
