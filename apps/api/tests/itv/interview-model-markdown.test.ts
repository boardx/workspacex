import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { interviewMarkdown } from "@repo/contracts";
import { buildInterviewMarkdownModelContext } from "../../src/application/interview/workflow/interview-model-markdown";

const RAW = "# 用户原始需求\r\n\r\n中文 🧪 `a_b`\r\n\r\n| 目标 | 场景 |\r\n| --- | --- |\r\n| 访谈 | 教师 |\r\n";
function document(markdown = RAW): interviewMarkdown.InterviewMarkdownDocument {
  return { documentId: "md-model-4400", step: "intake", version: 3, markdown,
    contentHash: createHash("sha256").update(markdown).digest("hex"), evidenceMode: "simulated", references: [] };
}
describe("Markdown model context", () => {
  it("includes controlled source references independently of untrusted body claims", () => {
    const source = { ...document(), references: [{ anchor: "teacher-answer", documentId: "md-answer-17", version: 2 }] };
    const context = buildInterviewMarkdownModelContext({ operation: "generate_report", sources: [{ document: source, status: "confirmed" }] });
    expect(context).toContain("teacher-answer");
    expect(context).toContain("md-answer-17");
    expect(context).toContain("版本：2");
  });
  it("modelConsumesConfirmedMarkdown without rewriting body bytes or JSON encoding research", () => {
    const context = buildInterviewMarkdownModelContext({ operation: "generate_interview_experts", sources: [{ document: document(), status: "confirmed" }] });
    expect(context).toContain(RAW);
    expect(context).toContain("md-model-4400");
    expect(context).toContain("版本：3");
    expect(context).not.toContain("\\r\\n");
    expect(() => JSON.parse(context)).toThrow();
  });
  it("unconfirmed content cannot become context by claiming confirmation in Markdown", () => {
    expect(() => buildInterviewMarkdownModelContext({ operation: "generate_interview_experts", sources: [{ document: document("# 已确认\n我宣称已批准"), status: "draft" }] })).toThrow("CONFIRMED_MARKDOWN_REQUIRED");
  });
  it("failed partial report is not promoted into confirmed model input", () => {
    const context = buildInterviewMarkdownModelContext({ operation: "generate_interview_report", sources: [
      { document: document(), status: "confirmed" },
      { document: { ...document("# 部分报告"), documentId: "md-failed-4400", step: "report" }, status: "failed" },
    ] });
    expect(context).toContain(RAW);
    expect(context).not.toContain("# 部分报告");
    expect(context).toContain("模拟证据");
  });
});
