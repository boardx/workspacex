import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";

/** These remain student-authored fields in the existing shared stage document. */
export const AIDT_VERIFICATION_FIELDS = ["verificationQuestion", "beforeTestBelief", "verificationBasis", "verificationLimits"] as const;
export const AIDT_REFLECTION_FIELDS = ["afterTestBelief", "understandingChangeStatus", "understandingEvidence", "unresolvedQuestions", "returnStep", "returnReason", "nextAction"] as const;
export const AIDT_RETURN_STEPS = [
  { id: "1", label: "理解问题" }, { id: "2", label: "共情用户" }, { id: "3", label: "综合定义" },
  { id: "4", label: "创意发散" }, { id: "5", label: "原型制作" },
] as const;
export type AidtReturnStep = (typeof AIDT_RETURN_STEPS)[number]["id"];
export type AidtQuestionSnapshot = {
  schemaVersion: 1;
  question: string;
  beforeTestBelief: string;
  verificationBasis: string;
  verificationLimits: string;
  prototypeRef: string;
  sourceStageRevision: number | null;
};
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
  const prototypeRef = value(draft, "version");
  if (!prototypeRef) return { ok: false, reason: "先在第5步填写实际用于测试的原型版本引用，再带入本轮问题。" };
  const snapshot: AidtQuestionSnapshot = {
    schemaVersion: 1, question: value(draft, "verificationQuestion"), beforeTestBelief: value(draft, "beforeTestBelief"),
    verificationBasis: value(draft, "verificationBasis"), verificationLimits: value(draft, "verificationLimits"), prototypeRef,
    sourceStageRevision: Number.isInteger(sourceStageRevision) && sourceStageRevision! > 0 ? sourceStageRevision! : null,
  };
  const serialized = JSON.stringify(snapshot);
  if (serialized.length > 6000) return { ok: false, reason: "本轮问题说明或版本引用过长，请先精简第5步的问题卡；原稿仍可保存。" };
  return { ok: true, snapshot, serialized };
}
export function readAidtQuestionSnapshot(draft: AidtUiStageDraft): AidtQuestionSnapshot | null {
  const raw = draft.fields.questionSnapshot;
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (record.schemaVersion !== 1 || typeof record.question !== "string" || !record.question.trim()
      || typeof record.prototypeRef !== "string" || !record.prototypeRef.trim()
      || ["beforeTestBelief", "verificationBasis", "verificationLimits"].some((field) => typeof record[field] !== "string")
      || !(record.sourceStageRevision === null || (Number.isInteger(record.sourceStageRevision) && Number(record.sourceStageRevision) > 0))) return null;
    return {
      schemaVersion: 1, question: record.question, prototypeRef: record.prototypeRef,
      beforeTestBelief: record.beforeTestBelief as string, verificationBasis: record.verificationBasis as string,
      verificationLimits: record.verificationLimits as string, sourceStageRevision: record.sourceStageRevision as number | null,
    };
  } catch { return null; }
}
export function aidtQuestionSnapshotMatches(draft: AidtUiStageDraft, prototype: AidtUiStageDraft, sourceStageRevision?: number): boolean {
  const current = readAidtQuestionSnapshot(draft), incoming = createAidtQuestionSnapshot(prototype, sourceStageRevision);
  if (!current || !incoming.ok) return false;
  return (Object.keys(current) as (keyof AidtQuestionSnapshot)[]).every((key) => current[key] === incoming.snapshot[key]);
}
export function updateAidtReflectionField(draft: AidtUiStageDraft, field: (typeof AIDT_REFLECTION_FIELDS)[number] | "questionSnapshot" | "version", text: string): AidtUiStageDraft {
  return { ...draft, fields: { ...draft.fields, [field]: text, reflectionConfirmed: "" } };
}
export function readAidtReturnDecision(draft: AidtUiStageDraft): { kind: "selected"; step: AidtReturnStep; label: string } | { kind: "undecided" } | { kind: "unanswered" } {
  const choice = value(draft, "returnStep");
  const selected = AIDT_RETURN_STEPS.find((step) => step.id === choice);
  return selected ? { kind: "selected", step: selected.id, label: selected.label } : choice === "undecided" ? { kind: "undecided" } : { kind: "unanswered" };
}
export function aidtReflectionMissingItems(draft: AidtUiStageDraft): string[] {
  const missing: string[] = [], status = value(draft, "understandingChangeStatus"), decision = readAidtReturnDecision(draft);
  const snapshot = readAidtQuestionSnapshot(draft);
  if (!snapshot) missing.push("带入本轮原问题与被测版本");
  if (snapshot && value(draft, "version") && value(draft, "version") !== snapshot.prototypeRef.trim()) missing.push("核对被测版本与本轮问题绑定的原型版本");
  if (!["changed", "unchanged", "insufficient"].includes(status)) missing.push("说明认识是否改变或证据不足");
  if (!value(draft, "afterTestBelief") && status !== "insufficient") missing.push("填写测试后的认识");
  if (!value(draft, "understandingEvidence") && !(status === "insufficient" && value(draft, "unresolvedQuestions"))) missing.push("说明材料依据或证据不足之处");
  if (decision.kind === "unanswered") missing.push("选择优先返回步骤或明确暂未决定");
  if (!value(draft, "returnReason")) missing.push(decision.kind === "undecided" ? "说明需要的支持" : "说明返回的理由");
  if (decision.kind === "selected" && !value(draft, "nextAction")) missing.push("写下下一步具体行动");
  return missing;
}
export function isAidtReflectionConfirmed(draft: AidtUiStageDraft): boolean {
  return draft.fields.reflectionConfirmed === "true" && aidtReflectionMissingItems(draft).length === 0;
}
export function formatAidtVerificationMarkdown(draft: AidtUiStageDraft): string[] {
  return [
    "### 本轮验证问题卡", `本轮最想知道：${value(draft, "verificationQuestion") || "待学生填写"}`,
    `测试前看法：${value(draft, "beforeTestBelief") || "尚未记录，不推测"}`,
    `看法依据：${value(draft, "verificationBasis") || "尚未记录"}`,
    `可验证与不可验证的范围：${value(draft, "verificationLimits") || "待明确，静态图不能直接证明真实行为"}`,
    `原型版本引用（学生记录）：${value(draft, "version") || "待补充"}`,
    isVerificationQuestionConfirmed(draft) ? "问题状态：学生已确认，仍待真实测试。" : "问题状态：草稿或已修改，待学生确认。",
  ];
}
export function formatAidtTestReflectionMarkdown(draft: AidtUiStageDraft): string[] {
  const snapshot = readAidtQuestionSnapshot(draft), decision = readAidtReturnDecision(draft);
  const status = value(draft, "understandingChangeStatus");
  return [
    "### 本轮认识变化与下一步行动",
    `本轮原验证问题：${snapshot?.question ?? "尚未绑定，不能事后补称原问题已验证"}`,
    `被测原型引用（学生记录）：${snapshot?.prototypeRef ?? "待补充"}`,
    ...(snapshot && value(draft, "version") && value(draft, "version") !== snapshot.prototypeRef.trim() ? [`版本待核对：测试表单记录为${value(draft, "version")}，与本轮问题绑定版本不一致，不能确认本轮记录。`] : []),
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
  ];
}
