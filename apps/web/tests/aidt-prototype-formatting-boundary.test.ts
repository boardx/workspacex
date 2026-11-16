import { expect, it, vi } from "vitest";

// Poison the runtime dependencies instead of merely checking import spelling.
// The report/schema/label path must still load and format restored metadata.
vi.mock("@/lib/api-client", () => { throw new Error("Pure AIDT formatting imported api-client"); });
vi.mock("@/features/aidt/lib/aidt-prototype-versions", () => { throw new Error("Pure AIDT formatting imported the native API adapter"); });
vi.mock("@repo/contracts", () => { throw new Error("Pure AIDT formatting imported the contracts barrel"); });

it("formats a restored reference, frozen question and full report without loading network adapters or the contracts barrel", async () => {
  const { aidtUiReportMarkdown, emptyAidtUiDrafts } = await import("@/features/aidt/lib/aidt-ui-drafts");
  const { parseAidtPrototypeReference, updateAidtPrototypeReference } = await import("@/features/aidt/lib/aidt-prototype-reference");
  const { aidtPrototypeVersionLabel } = await import("@/features/aidt/lib/aidt-prototype-label");
  const { confirmAidtVerificationQuestion, createAidtQuestionSnapshot } = await import("@/features/aidt/lib/aidt-verification-loop");
  const reference = parseAidtPrototypeReference(JSON.stringify({ designId: "design", versionId: "v1", designName: "订座原型", seq: 1, summary: "首页", createdAt: "2026-11-16", source: "user", frameCount: 1, generatedFrameCount: 1 }));
  expect(reference).not.toBeNull();
  expect(aidtPrototypeVersionLabel(reference!)).toBe("订座原型 / v1：首页");
  expect(aidtPrototypeVersionLabel({ ...reference!, summary: "" })).toBe("订座原型 / v1");
  const drafts = emptyAidtUiDrafts();
  drafts[5] = updateAidtPrototypeReference(confirmAidtVerificationQuestion({ ...drafts[5]!, fields: { verificationQuestion: "是否看懂？" } })!, reference);
  const snapshot = createAidtQuestionSnapshot(drafts[5], 3); if (!snapshot.ok) throw new Error(snapshot.reason);
  drafts[6]!.fields.questionSnapshot = snapshot.serialized;
  const report = aidtUiReportMarkdown(drafts);
  expect(report).toContain("第5步当前原生版本引用：订座原型 / v1：首页");
  expect(report).toContain("第6步冻结原生版本：Design ID：design；版本 ID：v1");
  expect(report).toContain("实际内容、当前访问权限与研究证据仍需原服务和学生核对");
});
