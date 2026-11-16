import { readAidtQuestionSnapshot, aidtTestPrototypeMismatch, readAidtReturnDecision, isAidtReflectionConfirmed, type AidtQuestionSnapshot } from "@repo/contracts/aidt-return-reflection";
export { AIDT_RETURN_STEPS, readAidtQuestionSnapshot, aidtTestPrototypeMismatch, readAidtReturnDecision, aidtReflectionMissingItems, isAidtReflectionConfirmed } from "@repo/contracts/aidt-return-reflection";
export type { AidtQuestionSnapshot, AidtReturnStep } from "@repo/contracts/aidt-return-reflection";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { AIDT_PROTOTYPE_REFERENCE_FIELD, AIDT_ITERATION_FEEDBACK_FIELD, AIDT_ITERATION_REASON_FIELD, AIDT_ITERATION_PROTOTYPE_RELATION_FIELD, AidtIterationPrototypeRelationSchema, formatAidtPrototypeReference, readAidtPrototypeReference, readAidtIterationPrototypeReference, readAidtIterationPrototypeRelation, updateAidtPrototypeVersionText } from "./aidt-prototype-reference";
import { aidtPrototypeVersionLabel } from "./aidt-prototype-label";

/** These remain student-authored fields in the existing shared stage document. */
export const AIDT_VERIFICATION_FIELDS = ["verificationQuestion", "beforeTestBelief", "verificationBasis", "verificationLimits"] as const;
export const AIDT_REFLECTION_FIELDS = ["afterTestBelief", "understandingChangeStatus", "understandingEvidence", "unresolvedQuestions", "returnStep", "returnReason", "nextAction"] as const;
const value = (draft: AidtUiStageDraft, field: string): string => draft.fields[field]?.trim() ?? "";

export function aidtVerificationConfirmation(draft: AidtUiStageDraft): string {
  return JSON.stringify(AIDT_VERIFICATION_FIELDS.map((field) => value(draft, field)));
}
export function isVerificationQuestionConfirmed(draft: AidtUiStageDraft): boolean {
  return !!value(draft, "verificationQuestion") && draft.fields.verificationQuestionConfirmed === "true"
    && draft.fields.verificationQuestionConfirmation === aidtVerificationConfirmation(draft);
}
export function getAidtPrototypeGenerationReadiness(draft: AidtUiStageDraft): { ready: boolean; reason: string | null } {
  if (!value(draft, "verificationQuestion")) return { ready: false, reason: "先写下这次制作原型最想知道的问题；粗稿仍可保存。" };
  if (!isVerificationQuestionConfirmed(draft)) return { ready: false, reason: "请由学生确认本轮验证问题，再进入原型生成。" };
  return { ready: true, reason: null };
}
export function updateAidtVerificationField(draft: AidtUiStageDraft, field: (typeof AIDT_VERIFICATION_FIELDS)[number], text: string): AidtUiStageDraft {
  return { ...draft, fields: { ...draft.fields, [field]: text, verificationQuestionConfirmed: "", verificationQuestionConfirmation: "" } };
}
export function confirmAidtVerificationQuestion(draft: AidtUiStageDraft): AidtUiStageDraft | null {
  const confirmation = aidtVerificationConfirmation(draft);
  if (!value(draft, "verificationQuestion") || confirmation.length > 6000) return null;
  return { ...draft, fields: { ...draft.fields, verificationQuestionConfirmed: "true", verificationQuestionConfirmation: confirmation } };
}
export function createAidtQuestionSnapshot(draft: AidtUiStageDraft, sourceStageRevision?: number): { ok: true; snapshot: AidtQuestionSnapshot; serialized: string } | { ok: false; reason: string } {
  const gate = getAidtPrototypeGenerationReadiness(draft);
  if (!gate.ready) return { ok: false, reason: gate.reason! };
  const selected = readAidtPrototypeReference(draft);
  if (value(draft, AIDT_PROTOTYPE_REFERENCE_FIELD) && !selected) return { ok: false, reason: "真实原型引用无法读取，请重新选择或明确移除后保留学生文字记录。" };
  const prototypeRef = selected ? aidtPrototypeVersionLabel(selected) : value(draft, "version");
  if (!prototypeRef) return { ok: false, reason: "先在第5步填写实际用于测试的原型版本引用，再带入本轮问题。" };
  const snapshot: AidtQuestionSnapshot = {
    schemaVersion: 1, question: value(draft, "verificationQuestion"), beforeTestBelief: value(draft, "beforeTestBelief"),
    verificationBasis: value(draft, "verificationBasis"), verificationLimits: value(draft, "verificationLimits"), prototypeRef,
    ...(selected ? { prototypeDesignId: selected.designId, prototypeVersionId: selected.versionId } : {}),
    sourceStageRevision: Number.isInteger(sourceStageRevision) && sourceStageRevision! > 0 ? sourceStageRevision! : null,
  };
  const serialized = JSON.stringify(snapshot);
  if (serialized.length > 6000) return { ok: false, reason: "本轮问题说明或版本引用过长，请先精简第5步的问题卡；原稿仍可保存。" };
  return { ok: true, snapshot, serialized };
}
export function aidtQuestionSnapshotMatches(draft: AidtUiStageDraft, prototype: AidtUiStageDraft, sourceStageRevision?: number): boolean {
  const current = readAidtQuestionSnapshot(draft), incoming = createAidtQuestionSnapshot(prototype, sourceStageRevision);
  if (!current || !incoming.ok) return false;
  const next = incoming.snapshot;
  if (current.prototypeDesignId || next.prototypeDesignId) {
    if (current.prototypeDesignId !== next.prototypeDesignId || current.prototypeVersionId !== next.prototypeVersionId) return false;
  } else if (current.prototypeRef !== next.prototypeRef) return false;
  return (["question", "beforeTestBelief", "verificationBasis", "verificationLimits", "sourceStageRevision"] as const).every((key) => current[key] === next[key]);
}
export function updateAidtReflectionField(draft: AidtUiStageDraft, field: (typeof AIDT_REFLECTION_FIELDS)[number] | "questionSnapshot" | "version", text: string): AidtUiStageDraft {
  if (field === "version") return updateAidtPrototypeVersionText(draft, text);
  return { ...draft, fields: { ...draft.fields, [field]: text, reflectionConfirmed: "" } };
}
/** Current test selection is checked against frozen IDs; legacy text remains explicit history. */
export function aidtIterationPrototypeMissingItems(draft: AidtUiStageDraft): string[] {
  const missing: string[] = [], old = readAidtQuestionSnapshot(draft), produced = readAidtIterationPrototypeReference(draft);
  if (!old) missing.push("保留本轮旧问题与被测版本快照");
  if (!produced) missing.push("选择真实迭代产出版本");
  if (old?.prototypeDesignId && produced?.designId === old.prototypeDesignId && produced.versionId === old.prototypeVersionId) missing.push("迭代产出须与旧被测版本不同");
  if (!value(draft, AIDT_ITERATION_FEEDBACK_FIELD)) missing.push("说明本次修改依据的反馈或未解问题引用");
  if (!value(draft, AIDT_ITERATION_REASON_FIELD)) missing.push("说明新版相对旧版改了什么及原因");
  return missing;
}
export function confirmAidtIterationPrototypeRelation(draft: AidtUiStageDraft): { ok: true; draft: AidtUiStageDraft } | { ok: false; reason: string } {
  const missing = aidtIterationPrototypeMissingItems(draft);
  if (missing.length) return { ok: false, reason: missing.join("、") };
  const produced = readAidtIterationPrototypeReference(draft)!;
  const relation = AidtIterationPrototypeRelationSchema.safeParse({ schemaVersion: 1, questionSnapshot: draft.fields.questionSnapshot, producedDesignId: produced.designId, producedVersionId: produced.versionId, feedbackReference: value(draft, AIDT_ITERATION_FEEDBACK_FIELD), changeReason: value(draft, AIDT_ITERATION_REASON_FIELD) });
  if (!relation.success) return { ok: false, reason: "反馈引用或修改说明过长，请精简后再关联；原稿仍可保存。" };
  const serialized = JSON.stringify(relation.data);
  if (serialized.length > 6000) return { ok: false, reason: "关联说明超过单字段保存上限；请精简本次说明，旧问题快照未被改写。" };
  return { ok: true, draft: { ...draft, fields: { ...draft.fields, [AIDT_ITERATION_PROTOTYPE_RELATION_FIELD]: serialized, reflectionConfirmed: "" } } };
}
export function isAidtIterationPrototypeRelated(draft: AidtUiStageDraft): boolean {
  const relation = readAidtIterationPrototypeRelation(draft), produced = readAidtIterationPrototypeReference(draft);
  return aidtIterationPrototypeMissingItems(draft).length === 0 && !!relation && !!produced
    && relation.questionSnapshot === draft.fields.questionSnapshot && relation.producedDesignId === produced.designId && relation.producedVersionId === produced.versionId
    && relation.feedbackReference === value(draft, AIDT_ITERATION_FEEDBACK_FIELD) && relation.changeReason === value(draft, AIDT_ITERATION_REASON_FIELD);
}
export function formatAidtIterationPrototypeMarkdown(draft: AidtUiStageDraft): string[] {
  const produced = readAidtIterationPrototypeReference(draft), related = isAidtIterationPrototypeRelated(draft);
  if (!produced && !draft.fields.iterationPrototypeReference && !draft.fields.iterationPrototypeRelation) return [];
  const old = readAidtQuestionSnapshot(draft);
  return ["### 本轮迭代产出与旧版关系", produced ? `迭代产出原生版本：${formatAidtPrototypeReference(produced)}` : "迭代产出引用无法读取；未替换为其他版本。",
    `旧被测原型：${old?.prototypeRef ?? "尚缺本轮快照"}${old?.prototypeDesignId ? `；Design ID：${old.prototypeDesignId}；版本 ID：${old.prototypeVersionId}` : "（学生文字记录，实际对应待核对）"}`,
    `本次修改依据的反馈/未解问题引用（学生记录）：${value(draft, AIDT_ITERATION_FEEDBACK_FIELD) || "待补充"}`,
    `相对旧版的修改与原因：${value(draft, AIDT_ITERATION_REASON_FIELD) || "待学生说明"}`,
    related ? "关系状态：学生已将本次产出关联到旧问题快照及所列反馈；新版待测试，不代表效果已证实或全组投票。" : "关系状态：尚未关联，或旧快照/产出/说明已有变化；原记录保留，待重新核对。",
    "返回前四步不需要先产生或关联新版；历史文字版本说明仍保留，不能代替原生版本核对。"];
}
export function formatAidtVerificationMarkdown(draft: AidtUiStageDraft): string[] {
  const selected = readAidtPrototypeReference(draft);
  return [
    "### 本轮验证问题卡", `本轮最想知道：${value(draft, "verificationQuestion") || "待学生填写"}`,
    `测试前看法：${value(draft, "beforeTestBelief") || "尚未记录，不推测"}`,
    `看法依据：${value(draft, "verificationBasis") || "尚未记录"}`,
    `可验证与不可验证的范围：${value(draft, "verificationLimits") || "待明确，静态图不能直接证明真实行为"}`,
    `原型版本引用（学生记录）：${value(draft, "version") || "待补充"}`,
    ...(selected ? [`第5步当前原生版本引用：${formatAidtPrototypeReference(selected)}`] : value(draft, AIDT_PROTOTYPE_REFERENCE_FIELD) ? ["第5步真实原型引用格式无法读取；已保留原稿，尚待重新选择。"] : []),
    isVerificationQuestionConfirmed(draft) ? "问题状态：学生已确认，仍待真实测试。" : "问题状态：草稿或已修改，待学生确认。",
  ];
}
export function formatAidtTestReflectionMarkdown(draft: AidtUiStageDraft): string[] {
  const snapshot = readAidtQuestionSnapshot(draft), decision = readAidtReturnDecision(draft), selected = readAidtPrototypeReference(draft);
  const status = value(draft, "understandingChangeStatus");
  return [
    "### 本轮认识变化与下一步行动",
    `本轮原验证问题：${snapshot?.question ?? "尚未绑定，不能事后补称原问题已验证"}`,
    `被测原型引用（学生记录）：${snapshot?.prototypeRef ?? "待补充"}`,
    ...(snapshot?.prototypeDesignId ? [`第6步冻结原生版本：Design ID：${snapshot.prototypeDesignId}；版本 ID：${snapshot.prototypeVersionId}。这是本轮原问题的历史引用；不代表当前授权或研究证据已核验。`] : []),
    ...(selected ? [`第6步当前另选原生版本：${formatAidtPrototypeReference(selected)}`] : []),
    ...(aidtTestPrototypeMismatch(draft, snapshot) ? ["版本待核对：测试表单当前记录与本轮问题绑定版本不一致，不能确认本轮记录；冻结快照保持不变。"] : []),
    `问题来源共享版本：${snapshot?.sourceStageRevision ? `第5步 V${snapshot.sourceStageRevision}` : "未绑定共享版本回执"}`,
    `测试前看法：${snapshot?.beforeTestBelief || "尚未记录"}`,
    `测试后看法：${value(draft, "afterTestBelief") || "待学生填写"}`,
    `认识变化：${status === "changed" ? "有变化" : status === "unchanged" ? "暂未改变" : status === "insufficient" ? "证据不足，尚不能判断" : "尚未回答"}`,
    `变化依据（学生材料引用，待核对）：${value(draft, "understandingEvidence") || "尚缺材料依据"}`,
    `仍不确定：${value(draft, "unresolvedQuestions") || "尚未记录，不等于没有未解问题"}`,
    `下一轮入口：${decision.kind === "selected" ? `第${decision.step}步 · ${decision.label}` : decision.kind === "undecided" ? "暂未决定，待支持" : "尚未选择"}`,
    `选择理由或所需支持：${value(draft, "returnReason") || "待学生说明"}`,
    `下一步行动：${value(draft, "nextAction") || "尚未明确"}`,
    isAidtReflectionConfirmed(draft) ? "记录状态：编辑者已确认本轮学习记录；不代表测试通过或全组投票。" : "记录状态：草稿，待学生核对。",
    "返回前四步或暂未决定时保留旧原型；没有新版不抹去本轮学习，也不表示问题已解决。",
    ...formatAidtIterationPrototypeMarkdown(draft),
  ];
}
