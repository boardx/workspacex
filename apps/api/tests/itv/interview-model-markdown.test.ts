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

it("limits each expert task to its own profile and questions while retaining shared research", () => {
  const sources = [
    document("# 用户原始需求\n完整足球研究范围"),
    { ...document("## [教师](#expert-teacher)\n教师画像\n\n## [校长](#expert-principal)\n校长画像"), step: "experts" as const },
    { ...document("## [教师](#expert-teacher)\n最近一次备课？\n\n## [校长](#expert-principal)\n校长预算反例？"), step: "outline" as const },
  ];
  const context = buildInterviewMarkdownModelContext({ operation: "simulate_expert_teacher", expertId: "teacher", sources: sources.map(document => ({ document, status: "confirmed" as const })) });
  expect(context).toContain("完整足球研究范围");
  expect(context).toContain("教师画像");
  expect(context).toContain("最近一次备课？");
  expect(context).not.toContain("校长画像");
  expect(context).not.toContain("校长预算反例？");
  expect(sources[2]!.markdown).toContain("校长预算反例？");
});
