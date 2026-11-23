import { DESIGN_TEXT_MAX_CHARS } from "@repo/contracts/design-workbench";
import { readAidtStageRevision } from "./live-aidt-stages";
import { readAidtTestGroups } from "./aidt-test-groups";
import { aidtTestGroupPublicationMatches, readAidtTestGroupRound } from "./aidt-test-group-round";
import { isAidtReflectionConfirmed, readAidtReturnDecision, formatAidtTestReflectionMarkdown } from "./aidt-verification-loop";

/** The old learning record is fixed; the next prototype still uses the current confirmed S5 design. */
export async function loadAidtIterationDesignContext(input: { projectId: string; designId: string; entityId: string; revision: string | null | undefined; sessionToken: string; signal?: AbortSignal }) {
  if (!/^[1-9]\d*$/.test(input.revision ?? "")) throw new Error("AIDT_DESIGN_RETURN_CONTEXT_INVALID");
  const revision = Number(input.revision);
  if (!Number.isSafeInteger(revision)) throw new Error("AIDT_DESIGN_RETURN_CONTEXT_INVALID");
  const stage = await readAidtStageRevision(input.projectId, 6, revision, input.sessionToken, input.signal);
  const group = stage && readAidtTestGroups(stage.content.draft.fields).find(item => item.id === input.entityId);
  const round = stage && readAidtTestGroupRound(stage.content.draft, input.entityId);
  const decision = round && readAidtReturnDecision(round);
  if (!stage || stage.projectId !== input.projectId || stage.stageId !== 6 || stage.revision !== revision
    || !aidtTestGroupPublicationMatches(stage, input.entityId) || !group || group.archived || group.designId !== input.designId || !round || !isAidtReflectionConfirmed(round)
    || decision?.kind !== "selected" || decision.step !== "5" || input.signal?.aborted) throw new Error("AIDT_DESIGN_RETURN_CONTEXT_INVALID");
  return `上一轮学习来源：第6步 V${stage.revision}；测试记录 ${input.entityId}。以下是学生已保存的认识与选择，不是研究成功或供应商验证的证明。\n\n${formatAidtTestReflectionMarkdown(round).join("\n")}`;
}
export function aidtIterationDesignPrompt(currentConfirmedText: string, learning?: string) {
  const text = learning ? `${currentConfirmedText}\n\n${learning}\n\n本次制作采用上方当前已确认文字设计；不改写上轮被测版本。新版仍待测试。` : currentConfirmedText;
  if (text.length > DESIGN_TEXT_MAX_CHARS) throw new Error("AIDT_DESIGN_CONTEXT_TOO_LONG");
  return text;
}
