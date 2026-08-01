/**
 * `confirmOutline` —— 研究员确认大纲（F84，uc-6-2 R3 步骤3 收口，AC5）。
 *
 * 状态从 `pending_confirm` 转 `confirmed` 之后，`startSession` 才可能放行进现场（I-10）。
 * 本函数不做「每段都有目标与≥2条开场问法」的完整性校验（那是 `OUTLINE_INCOMPLETE`，
 * F85 大纲编辑器的范围——本 feature 生成的草案本身已经满足 AC1，见
 * `domain/interview/outline.ts` 的 `generateOutlineDraft`），这里只做状态转移。
 */
import type { OrgId } from "../../domain/org-id";
import type { OutlineRecord, OutlineRepository } from "./outline-ports";

export interface ConfirmOutlineDeps {
  readonly outlines: OutlineRepository;
}

export interface ConfirmOutlineDto {
  readonly orgId: OrgId;
  readonly outlineId: string;
}

export async function confirmOutline(deps: ConfirmOutlineDeps, input: ConfirmOutlineDto): Promise<OutlineRecord> {
  return deps.outlines.confirm(input.orgId, input.outlineId);
}
