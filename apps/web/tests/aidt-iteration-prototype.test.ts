import { expect, it } from "vitest";
import { StageContent } from "@repo/contracts/aidt-stages";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { AIDT_ITERATION_FEEDBACK_FIELD, AIDT_ITERATION_REASON_FIELD, readAidtIterationPrototypeReference, readAidtPrototypeReference, updateAidtIterationBasis, updateAidtIterationPrototypeReference, updateAidtIterationVersionText, updateAidtPrototypeReference } from "@/features/aidt/lib/aidt-prototype-reference";
import { aidtReflectionMissingItems, confirmAidtIterationPrototypeRelation, confirmAidtVerificationQuestion, createAidtQuestionSnapshot, formatAidtTestReflectionMarkdown, isAidtIterationPrototypeRelated, readAidtQuestionSnapshot } from "@/features/aidt/lib/aidt-verification-loop";
import type { AidtPrototypeVersionReference } from "@/features/aidt/lib/aidt-prototype-versions";
const native = (versionId = "v1", seq = 1): AidtPrototypeVersionReference => ({ designId: "design", versionId, seq, designName: "入口静态示意", summary: "学生选择的历史版本", source: "model", createdAt: "2026-11-16", frameCount: 1, generatedFrameCount: 1 });
function round(): AidtUiStageDraft {
  const prototype = confirmAidtVerificationQuestion(updateAidtPrototypeReference({ ...emptyAidtUiDrafts()[5]!, fields: { verificationQuestion: "能否看懂原入口？" } }, native()))!;
  const result = createAidtQuestionSnapshot(prototype, 3); if (!result.ok) throw new Error(result.reason);
  return updateAidtPrototypeReference({ ...emptyAidtUiDrafts()[6]!, fields: { questionSnapshot: result.serialized, understandingChangeStatus: "insufficient", unresolvedQuestions: "材料还不足", returnStep: "2", returnReason: "补访", nextAction: "请受访者讲经历", newVersion: "旧的学生手工新版说明" } }, native());
}
function prepared() {
  let value = updateAidtIterationPrototypeReference(round(), native("v2", 2));
  value = updateAidtIterationBasis(value, AIDT_ITERATION_FEEDBACK_FIELD, "测试材料A 00:32；学生记录，仍待核对");
  return updateAidtIterationBasis(value, AIDT_ITERATION_REASON_FIELD, "根据未能找到入口的反馈，改清入口提示；新版仍待测试");
}
it("persists V2 separately with its exact old V1 question snapshot and feedback relation through the existing stage contract", () => {
  const before = round(), next = prepared(), result = confirmAidtIterationPrototypeRelation(next);
  expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.reason);
  const restored = StageContent.parse(JSON.parse(JSON.stringify({ schemaVersion: 1, draft: result.draft }))).draft;
  expect(readAidtIterationPrototypeReference(restored)?.versionId).toBe("v2");
  expect(readAidtPrototypeReference(restored)?.versionId).toBe("v1");
  expect(restored.fields.questionSnapshot).toBe(before.fields.questionSnapshot);
  expect(readAidtQuestionSnapshot(restored)?.prototypeVersionId).toBe("v1");
  expect(restored.fields.newVersion).toBe("旧的学生手工新版说明");
  expect(isAidtIterationPrototypeRelated(restored)).toBe(true);
  expect(aidtReflectionMissingItems(restored)).toEqual([]);
  const report = formatAidtTestReflectionMarkdown(restored).join("\n");
  expect(report).toContain("第6步冻结原生版本：Design ID：design；版本 ID：v1");
  expect(report).toContain("迭代产出原生版本：入口静态示意 / v2");
  expect(report).toContain("测试材料A 00:32"); expect(report).toContain("新版待测试，不代表效果已证实");
});
it("invalidates relation on new-output edits without changing the old tested object or frozen question", () => {
  const result = confirmAidtIterationPrototypeRelation(prepared()); if (!result.ok) throw new Error(result.reason);
  const edited = updateAidtIterationBasis(result.draft, AIDT_ITERATION_FEEDBACK_FIELD, "改用材料B");
  expect(isAidtIterationPrototypeRelated(edited)).toBe(false);
  const manual = updateAidtIterationVersionText(result.draft, "学生重写的新版引用");
  expect(readAidtIterationPrototypeReference(manual)).toBeNull(); expect(isAidtIterationPrototypeRelated(manual)).toBe(false);
  expect(readAidtPrototypeReference(manual)?.versionId).toBe("v1");
  expect(manual.fields.questionSnapshot).toBe(result.draft.fields.questionSnapshot);
  expect(readAidtIterationPrototypeReference(updateAidtIterationVersionText(manual, result.draft.fields.newVersion!))).toBeNull();
});
it("refuses the same native version, absent feedback, tampered binding and an oversized relation rather than fabricating a new iteration", () => {
  expect(confirmAidtIterationPrototypeRelation(updateAidtIterationPrototypeReference(prepared(), native())).ok).toBe(false);
  expect(confirmAidtIterationPrototypeRelation(updateAidtIterationBasis(prepared(), AIDT_ITERATION_FEEDBACK_FIELD, "")).ok).toBe(false);
  const result = confirmAidtIterationPrototypeRelation(prepared()); if (!result.ok) throw new Error(result.reason);
  const forged = { ...result.draft, fields: { ...result.draft.fields, iterationPrototypeReference: JSON.stringify(native("v3", 3)) } };
  expect(isAidtIterationPrototypeRelated(forged)).toBe(false);
  const large = prepared(); const raw = JSON.parse(large.fields.questionSnapshot!); raw.verificationBasis = "依据".repeat(1600); large.fields.questionSnapshot = JSON.stringify(raw);
  large.fields.iterationFeedbackReference = "待核对的反馈".repeat(300); large.fields.iterationChangeReason = "学生修改原因".repeat(300);
  const original = large.fields.questionSnapshot; expect(confirmAidtIterationPrototypeRelation(large).ok).toBe(false); expect(large.fields.questionSnapshot).toBe(original);
});
it.each(["1", "2", "3", "4"])("retains a valid return-to-%s learning record without requiring V2 or a relation", step => {
  const value = round(); value.fields.returnStep = step;
  expect(aidtReflectionMissingItems(value)).toEqual([]);
  expect(value.fields.iterationPrototypeReference).toBeUndefined();
  expect(value.fields.iterationPrototypeRelation).toBeUndefined();
});
it("refuses a serialized relation above 6000 even when each individual field satisfies its schema limit", () => {
  const draft = prepared(), raw = JSON.parse(draft.fields.questionSnapshot!);
  raw.verificationBasis = "依".repeat(2600);
  draft.fields.questionSnapshot = JSON.stringify(raw);
  draft.fields.iterationFeedbackReference = "反".repeat(1900);
  draft.fields.iterationChangeReason = "改".repeat(1900);
  const before = JSON.stringify(draft);
  expect(draft.fields.questionSnapshot.length).toBeLessThan(6000);
  expect(readAidtQuestionSnapshot(draft)).not.toBeNull();
  const result = confirmAidtIterationPrototypeRelation(draft);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Unexpected over-limit relation");
  expect(result.reason).toContain("单字段保存上限");
  expect(JSON.stringify(draft)).toBe(before);
});
