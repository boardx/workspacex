import { describe, expect, it } from "vitest";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { aidtQuestionSnapshotMatches, aidtReflectionMissingItems, confirmAidtVerificationQuestion, createAidtQuestionSnapshot, formatAidtTestReflectionMarkdown, getAidtPrototypeGenerationReadiness, isAidtReflectionConfirmed, isVerificationQuestionConfirmed, readAidtQuestionSnapshot, readAidtReturnDecision, updateAidtReflectionField, updateAidtVerificationField } from "@/features/aidt/lib/aidt-verification-loop";

const blank = (): AidtUiStageDraft => emptyAidtUiDrafts()[5]!;
const prototype = () => confirmAidtVerificationQuestion({ ...blank(), fields: { verificationQuestion: "愿不愿意等待？", beforeTestBelief: "也许愿意", version: "原型 V1" } })!;
function reflection(): AidtUiStageDraft {
  const snapshot = createAidtQuestionSnapshot(prototype(), 3);
  if (!snapshot.ok) throw new Error(snapshot.reason);
  return { ...blank(), fields: { questionSnapshot: snapshot.serialized, afterTestBelief: "与情境有关", understandingChangeStatus: "changed", understandingEvidence: "本组测试A 00:30", returnStep: "2", returnReason: "赶课者差异需补访", nextAction: "补访赶课者" } };
}
describe("student confirmation before generation", () => {
  it("allows unknown beliefs but never bypasses confirmation with a raw boolean", () => {
    const initial = { ...blank(), fields: { verificationQuestion: "如何理解流程？", verificationQuestionConfirmed: "true" } };
    expect(getAidtPrototypeGenerationReadiness(initial).ready).toBe(false);
    const confirmed = confirmAidtVerificationQuestion(initial)!;
    expect(getAidtPrototypeGenerationReadiness(confirmed).ready).toBe(true);
    expect(confirmed.fields.beforeTestBelief).toBeUndefined();
    expect(createAidtQuestionSnapshot(confirmed).ok).toBe(false);
    expect(confirmAidtVerificationQuestion(blank())).toBeNull();
  });
  it("invalidates confirmation when any question-card content changes and preserves existing data", () => {
    const before = prototype();
    const next = updateAidtVerificationField(before, "verificationBasis", "只是猜测");
    expect(isVerificationQuestionConfirmed(next)).toBe(false);
    expect(next.fields.version).toBe("原型 V1");
    expect(isVerificationQuestionConfirmed({ ...before, fields: { ...before.fields, beforeTestBelief: "事后改写" } })).toBe(false);
    expect(confirmAidtVerificationQuestion({ ...blank(), fields: { verificationQuestion: "长".repeat(6000) } })).toBeNull();
  });
});
describe("immutable round context", () => {
  it("captures an explicitly identified prototype and actual saved source revision", () => {
    const result = createAidtQuestionSnapshot(prototype(), 3);
    expect(result.ok).toBe(true);
    const draft = reflection();
    expect(readAidtQuestionSnapshot(draft)).toMatchObject({ question: "愿不愿意等待？", beforeTestBelief: "也许愿意", prototypeRef: "原型 V1", sourceStageRevision: 3 });
    expect(aidtQuestionSnapshotMatches(draft, prototype(), 3)).toBe(true);
    expect(aidtQuestionSnapshotMatches(draft, prototype(), 4)).toBe(false);
    const changed = confirmAidtVerificationQuestion({ ...prototype(), fields: { ...prototype().fields, verificationQuestion: "能否看懂？" } })!;
    expect(aidtQuestionSnapshotMatches(draft, changed, 3)).toBe(false);
    expect(readAidtQuestionSnapshot(draft)?.question).toBe("愿不愿意等待？");
  });
  it("rejects malformed snapshots and preserves a missing source receipt as null", () => {
    for (const raw of ["invalid", "[]", '{"schemaVersion":1}', JSON.stringify({ schemaVersion: 1, question: "?", prototypeRef: "V1", beforeTestBelief: "", verificationBasis: "", verificationLimits: "", sourceStageRevision: -1 })]) {
      expect(readAidtQuestionSnapshot({ ...blank(), fields: { questionSnapshot: raw } })).toBeNull();
    }
    const result = createAidtQuestionSnapshot(prototype());
    expect(result.ok && result.snapshot.sourceStageRevision).toBeNull();
    const huge = confirmAidtVerificationQuestion({ ...prototype(), fields: { ...prototype().fields, version: "V".repeat(6000) } })!;
    expect(createAidtQuestionSnapshot(huge).ok).toBe(false);
  });
});
describe("reflection preserves valid learning branches", () => {
  it.each(["1", "2", "3", "4", "5"])("records return to stage %s without requiring a new prototype", (returnStep) => {
    const draft = reflection(); draft.fields.returnStep = returnStep;
    expect(aidtReflectionMissingItems(draft)).toEqual([]);
    expect(isAidtReflectionConfirmed({ ...draft, fields: { ...draft.fields, reflectionConfirmed: "true" } })).toBe(true);
    expect(draft.fields.newVersion).toBeUndefined();
    expect(readAidtReturnDecision(draft).kind).toBe("selected");
  });
  it("accepts explicit insufficient evidence and undecided support without inventing an outcome or action", () => {
    const draft = reflection();
    draft.fields = { ...draft.fields, understandingChangeStatus: "insufficient", afterTestBelief: "", understandingEvidence: "", unresolvedQuestions: "还没找到实际行为记录", returnStep: "undecided", returnReason: "请教师帮助判断补访方向", nextAction: "", reflectionConfirmed: "true" };
    expect(aidtReflectionMissingItems(draft)).toEqual([]);
    expect(isAidtReflectionConfirmed(draft)).toBe(true);
    expect(readAidtReturnDecision(draft)).toEqual({ kind: "undecided" });
    expect(readAidtReturnDecision({ ...draft, fields: { ...draft.fields, returnStep: "" } })).toEqual({ kind: "unanswered" });
    expect(isAidtReflectionConfirmed(updateAidtReflectionField(draft, "returnReason", "修改支持请求"))).toBe(false);
    const report = formatAidtTestReflectionMarkdown(draft).join("\n");
    expect(report).toContain("证据不足，尚不能判断");
    expect(report).toContain("暂未决定，待支持");
    expect(report).toContain("不代表测试通过或全组投票");
  });
  it("requires students' explanations for unchanged understanding", () => {
    const draft = reflection(); draft.fields.understandingChangeStatus = "unchanged";
    expect(aidtReflectionMissingItems(draft)).toEqual([]);
    draft.fields.understandingEvidence = "";
    expect(aidtReflectionMissingItems(draft)).toContain("说明材料依据或证据不足之处");
  });
  it("does not repeat a snapshot's version requirement but rejects conflicting test references", () => {
    const draft = reflection();
    expect(aidtReflectionMissingItems(draft)).toEqual([]);
    draft.fields.version = "原型 V2";
    draft.fields.reflectionConfirmed = "true";
    expect(aidtReflectionMissingItems(draft)).toContain("核对被测版本与本轮问题绑定的原型版本");
    expect(isAidtReflectionConfirmed(draft)).toBe(false);
    expect(formatAidtTestReflectionMarkdown(draft).join("\n")).toContain("版本待核对");
    const corrected = updateAidtReflectionField(draft, "version", " 原型 V1 ");
    expect(corrected.fields.reflectionConfirmed).toBe("");
    expect(aidtReflectionMissingItems(corrected)).toEqual([]);
    const rebound = updateAidtReflectionField({ ...corrected, fields: { ...corrected.fields, reflectionConfirmed: "true" } }, "questionSnapshot", draft.fields.questionSnapshot!);
    expect(rebound.fields.reflectionConfirmed).toBe("");
  });
});
