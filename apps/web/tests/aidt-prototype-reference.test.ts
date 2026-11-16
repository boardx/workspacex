import { expect, it } from "vitest";
import { StageContent } from "@repo/contracts/aidt-stages";
import { parseAidtPrototypeReference, readAidtPrototypeReference, sameAidtPrototypeVersion, updateAidtPrototypeReference, updateAidtPrototypeVersionText } from "@/features/aidt/lib/aidt-prototype-reference";
import { aidtUiReportMarkdown, aidtUiStageSummary, emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import { aidtQuestionSnapshotMatches, aidtTestPrototypeMismatch, confirmAidtVerificationQuestion, createAidtQuestionSnapshot, readAidtQuestionSnapshot } from "@/features/aidt/lib/aidt-verification-loop";
import type { AidtPrototypeVersionReference } from "@/features/aidt/lib/aidt-prototype-versions";
const reference = (versionId = "v1", seq = 1): AidtPrototypeVersionReference => ({ designId: "design", versionId, seq, designName: "订座原型", source: "model", summary: "首页", createdAt: "2026-11-16T00:00:00Z", frameCount: 2, generatedFrameCount: 1 });
const prototype = () => confirmAidtVerificationQuestion({ ...emptyAidtUiDrafts()[5]!, fields: { version: "学生旧文字V0", verificationQuestion: "是否看懂？" } })!;

it("round-trips canonical reference metadata through existing shared stage fields without changing legacy text", () => {
  const next = updateAidtPrototypeReference(prototype(), reference());
  const saved = StageContent.parse({ schemaVersion: 1, draft: next });
  const restored = JSON.parse(JSON.stringify(saved)) as typeof saved;
  expect(readAidtPrototypeReference(restored.draft)).toEqual(reference());
  expect(restored.draft.fields.version).toBe("学生旧文字V0");
  expect(restored.draft.fields.prototypeReference!.length).toBeLessThanOrEqual(6000);
});
it("rejects malformed/untrusted restored metadata instead of treating it as an authorized native reference", () => {
  for (const raw of ["invalid", "[]", "null", "x".repeat(6001), JSON.stringify({ ...reference(), authorized: true }), JSON.stringify({ ...reference(), designId: ".." }), JSON.stringify({ ...reference(), versionId: "\n" }), JSON.stringify({ ...reference(), seq: 0 }), JSON.stringify({ ...reference(), generatedFrameCount: 0 }), JSON.stringify({ ...reference(), generatedFrameCount: 3 }), JSON.stringify({ ...reference(), frameCount: 1.5 })]) {
    expect(parseAidtPrototypeReference(raw)).toBeNull();
  }
  expect(parseAidtPrototypeReference(null)).toBeNull();
  expect(parseAidtPrototypeReference(undefined)).toBeNull();
  expect(() => updateAidtPrototypeReference(prototype(), { ...reference(), versionId: "id".repeat(3100) })).toThrow("AIDT_PROTOTYPE_REFERENCE_TOO_LARGE");
});
it("removes only the selected marker and confirmation, preserving historical text and the frozen question", () => {
  const initial = { ...prototype(), fields: { ...prototype().fields, questionSnapshot: "frozen raw history", reflectionConfirmed: "true" } };
  const selected = updateAidtPrototypeReference(initial, reference());
  const cleared = updateAidtPrototypeReference(selected, null);
  expect(readAidtPrototypeReference(cleared)).toBeNull();
  expect(cleared.fields.version).toBe("学生旧文字V0");
  expect(cleared.fields.questionSnapshot).toBe("frozen raw history");
  expect(cleared.fields.reflectionConfirmed).toBe("");
  expect(selected.fields.questionSnapshot).toBe("frozen raw history");
});
it("manual version edits clear native markers even when students type the original label again", () => {
  const selected = updateAidtPrototypeReference(prototype(), reference());
  const next = updateAidtPrototypeVersionText(selected, "手工新说明");
  const reverted = updateAidtPrototypeVersionText(next, selected.fields.version!);
  expect(readAidtPrototypeReference(next)).toBeNull(); expect(readAidtPrototypeReference(reverted)).toBeNull();
  expect(readAidtPrototypeReference(selected)).toEqual(reference());
  expect(reverted.fields.version).toBe("学生旧文字V0");
});
it("compares actual version identity independently from names and descriptive metadata", () => {
  expect(sameAidtPrototypeVersion(reference(), { ...reference(), designName: "改名", summary: "新标题" })).toBe(true);
  expect(sameAidtPrototypeVersion(reference(), reference("v2", 2))).toBe(false);
  expect(sameAidtPrototypeVersion(reference(), { ...reference(), designId: "other-design" })).toBe(false);
});
it("freezes S6 v1 while changing S5 to v2, then displays each version separately in the report", () => {
  const drafts = emptyAidtUiDrafts(); drafts[5] = updateAidtPrototypeReference(prototype(), reference());
  const result = createAidtQuestionSnapshot(drafts[5], 4); if (!result.ok) throw new Error(result.reason);
  drafts[6] = { ...drafts[6]!, fields: { questionSnapshot: result.serialized } };
  const frozen = drafts[6].fields.questionSnapshot;
  drafts[5] = updateAidtPrototypeReference(drafts[5], reference("v2", 2));
  expect(drafts[6].fields.questionSnapshot).toBe(frozen);
  expect(readAidtQuestionSnapshot(drafts[6])?.prototypeVersionId).toBe("v1");
  expect(aidtQuestionSnapshotMatches(drafts[6], drafts[5], 4)).toBe(false);
  const report = aidtUiReportMarkdown(drafts);
  const stage5 = report.slice(report.indexOf("## 5."), report.indexOf("## 6."));
  const stage6 = report.slice(report.indexOf("## 6."));
  expect(stage5).toContain("第5步当前原生版本引用：订座原型 / v2");
  expect(stage5).toContain("版本 ID：v2");
  expect(stage6).toContain("第6步冻结原生版本：Design ID：design；版本 ID：v1");
  expect(stage6).not.toContain("版本 ID：v2");
  expect(stage5).toContain("当前访问权限与研究证据仍需原服务和学生核对");
  expect(stage6).toContain("不代表当前授权或研究证据已核验");
});
it("keeps restored history readable after external access may have changed, with no live authorization claim", () => {
  const drafts = emptyAidtUiDrafts();
  drafts[5] = StageContent.parse({ schemaVersion: 1, draft: updateAidtPrototypeReference(prototype(), reference()) }).draft;
  const report = aidtUiReportMarkdown(drafts);
  expect(readAidtPrototypeReference(drafts[5])).toEqual(reference());
  expect(report).toContain("记录结构可读；实际内容、当前访问权限与研究证据仍需原服务和学生核对");
  expect(report).not.toContain("曾成功读取");
  expect(report).not.toContain("当前已授权"); expect(report).not.toContain("证据核验通过");
});
it("includes a reference-only stage in handoff summaries and detects a separately selected S6 version", () => {
  const selectedOnly = updateAidtPrototypeReference(emptyAidtUiDrafts()[5]!, reference());
  expect(aidtUiStageSummary(5, selectedOnly)).toContain("第5步当前原生版本引用");
  const result = createAidtQuestionSnapshot(updateAidtPrototypeReference(prototype(), reference()));
  if (!result.ok) throw new Error(result.reason);
  const test = updateAidtPrototypeReference({ ...emptyAidtUiDrafts()[6]!, fields: { questionSnapshot: result.serialized } }, reference("v2", 2));
  expect(aidtTestPrototypeMismatch(test)).toBe(true);
  expect(readAidtQuestionSnapshot(test)?.prototypeVersionId).toBe("v1");
});
