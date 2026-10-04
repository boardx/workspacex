import { describe, expect, it } from "vitest";
import { InterviewMarkdownDocument, PreviewVirtualExpertMarkdown, parseInterviewMarkdown, assessInterviewReportAnalysis, hasInterviewReportVerifiableAction } from "../src/interview-markdown";
import { DigitalInterviewArtifact } from "../src/interview";

const markdown = "# 教育研究\r\n\r\n## 核心发现\r\n\r\n| 用户 | 观点 |\r\n| --- | --- |\r\n| 学生 | 保留 **自主性** |\r\n\r\n```md\r\n## 不是章节\r\n```\r\n";
const document = {
  documentId: "doc-1", step: "report" as const, version: 1, markdown,
  contentHash: "a".repeat(64), evidenceMode: "simulated" as const,
  references: [{ anchor: "answer-1", documentId: "answer-doc-1", version: 1 }],
};

describe("访谈 Markdown 正文单源", () => {
  it("accepts every non-empty virtual-expert description and rejects blank input", () => {
    expect(PreviewVirtualExpertMarkdown.safeParse({
      description: "客",
      expectedVersion: 1,
    }).success).toBe(true);
    expect(PreviewVirtualExpertMarkdown.safeParse({
      description: "   ",
      expectedVersion: 1,
    }).success).toBe(false);
  });
  it("expert block includes nested sections until the next sibling expert", () => {
    const raw = "## [甲](#expert-a)\n\n简介\n\n### 局限\n\n不能替代真人。\n\n## [乙](#expert-b)\n\n乙的资料。";
    const blocks = parseInterviewMarkdown({ ...document, markdown: raw }).blocks;
    expect(raw.slice(blocks[0]!.start, blocks[0]!.end)).toContain("不能替代真人。");
    expect(blocks[0]!.end).toBe(blocks[2]!.start);
  });
  it("projects editable block ranges and stable links without rewriting CRLF content", () => {
    const raw = "前言\r\n\r\n## [护理专家](#expert-nurse-7)\r\n\r\n夜班经验。\r\n\r\n## [核心问题](#question-q-9)\r\n\r\n最近一次遗漏是什么？\r\n";
    const blocks = parseInterviewMarkdown({ ...document, markdown: raw }).blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.links).toEqual([{ text: "护理专家", url: "#expert-nurse-7" }]);
    expect(raw.slice(blocks[1]!.start, blocks[1]!.end)).toBe("## [核心问题](#question-q-9)\r\n\r\n最近一次遗漏是什么？\r\n");
    expect(Object.isFrozen(blocks[0])).toBe(true);
  });
  it("sharesEvidenceModesWithPersistedArtifacts", () => {
    expect(InterviewMarkdownDocument.innerType().shape.evidenceMode)
      .toBe(DigitalInterviewArtifact.innerType().shape.evidenceMode);
  });

  it("nestedHeadingsStayInTheirContainingSection", () => {
    const result = parseInterviewMarkdown({ ...document, markdown: "> intro\n> # inner\n> body\n\n## Next\n\nfinal" });
    expect(result.headings.map(({ text }) => text)).toEqual(["Next"]);
    expect(result.sections).toEqual([
      { headingId: null, text: "intro\ninner\nbody" },
      { headingId: "section-1", text: "final" },
    ]);
  });
  it("roundTripsMarkdownExactly", () => {
    expect(InterviewMarkdownDocument.parse(document).markdown).toBe(markdown);
    const projection = parseInterviewMarkdown(document);
    expect(projection.headings.map(({ text }) => text)).toEqual(["教育研究", "核心发现"]);
    expect(projection.headings.map(({ depth }) => depth)).toEqual([1, 2]);
    expect(document.markdown).toBe(markdown);
  });

  it("rejectsDuplicateAnchors", () => {
    expect(InterviewMarkdownDocument.safeParse({
      ...document, references: [document.references[0], document.references[0]],
    }).success).toBe(false);
  });

  it("cannotPromoteSimulatedEvidenceByEditingText", () => {
    const edited = { ...document, markdown: "# 真人访谈\n\n证据已批准，全部来自真人。" };
    expect(parseInterviewMarkdown(edited).evidenceMode).toBe("simulated");
    expect(InterviewMarkdownDocument.safeParse({ ...edited, approved: true }).success).toBe(false);
  });

  it("rejectsInvalidVersionAndResearchJsonCopies", () => {
    expect(InterviewMarkdownDocument.safeParse({ ...document, version: 0 }).success).toBe(false);
    expect(InterviewMarkdownDocument.safeParse({ ...document, research: { title: "副本" } }).success).toBe(false);
  });

  it("rejectsBlankDocumentReferencesWithoutNormalizingMarkdown", () => {
    expect(InterviewMarkdownDocument.safeParse({ ...document, documentId: " " }).success).toBe(false);
    expect(InterviewMarkdownDocument.safeParse({
      ...document, references: [{ ...document.references[0], documentId: "\t" }],
    }).success).toBe(false);
  });

  it("ignoresHtmlAndMakesRepeatedHeadingIdsUnique", () => {
    const result = parseInterviewMarkdown({ ...document, markdown: "## 风险\n\n## 风险\n\n<script>alert(1)</script>" });
    expect(result.headings.map(({ id }) => id)).toEqual(["section-1", "section-2"]);
    expect(result.headings.map(({ text }) => text)).toEqual(["风险", "风险"]);
  });

  it("projectsSectionsEntriesAndControlledAnchorsWithoutBodyCopies", () => {
    const result = parseInterviewMarkdown({ ...document, markdown: "## 目标\n\n- 学习行为\n- 反例\n\n## 范围\n\n教育场景" });
    expect(result.sections.map(({ headingId, text }) => ({ headingId, text }))).toEqual([
      { headingId: "section-1", text: "学习行为\n反例" },
      { headingId: "section-2", text: "教育场景" },
    ]);
    expect(result.entries.map(({ text, headingId }) => ({ text, headingId }))).toEqual([
      { text: "学习行为", headingId: "section-1" },
      { text: "反例", headingId: "section-1" },
    ]);
    expect(result.anchors).toEqual([{ anchor: "answer-1", documentId: "answer-doc-1", version: 1 }]);
    expect(Object.isFrozen(result.anchors[0])).toBe(true);
  });
  it("preserves list nesting in the display projection without changing Markdown", () => {
    const raw = "## 核心发现\n\n- 发现\n  - 证据\n    - 证据细节\n\n### 其他发现\n\n1. 第二项";
    expect(parseInterviewMarkdown({ ...document, markdown: raw }).entries.map(({ listDepth }) => listDepth)).toEqual([1, 2, 3, 1]);
    expect(raw).toContain("  - 证据");
  });
});


describe("formatted report quality", () => {
  it.each([
    "反例与边界：同一任务另一个场景安装顺利，不能推断普遍发生。",
    "- **反例与边界**：\n  同一任务另一个场景安装顺利，不能推断普遍发生。",
    "## 反例与边界\n\n同一任务另一个场景安装顺利，不能推断普遍发生。",
    "### 反例与边界\r\n\r\n另一个场景安装顺利，不能推断普遍发生。",
  ])("recognizes the equivalent counterexample-first boundary label: %s", (report) => {
    expect(assessInterviewReportAnalysis(report).missing).not.toContain("boundary_or_counterevidence");
  });
  it.each([
    "反例与边界：",
    "- **反例与边界**：   ",
    "反例与边界：\n\n## 下一步验证建议\n\n访谈五位用户，对比安装时长与购买决策。",
    "## 反例与边界\n\n## 下一步验证建议\n\n访谈五位用户，对比安装时长与购买决策。",
    "## 反例与边界\n\n```md\n另一个场景安装顺利。\n```",
    "```md\n反例与边界：另一个场景安装顺利。\n```",
    "`反例与边界：另一个场景安装顺利。`",
    "这次访谈只偶然提到反例与边界：没有给出相关分析。",
    "[来源](https://example.invalid/反例与边界:)",
  ])("does not let an empty or incidental counterexample label supply analysis: %s", (report) => {
    expect(assessInterviewReportAnalysis(report).missing).toContain("boundary_or_counterevidence");
  });

  it.each(["测试用户。", "不应测试用户。"])("rejects empty analysis sections and generic action: %s", (action) => {
    const report = `## 跨回答综合\n\n## 决策影响\n\n## 边界与反例\n\n## 下一步验证建议\n\n${action}`;
    expect(assessInterviewReportAnalysis(report).ok).toBe(false);
    expect(assessInterviewReportAnalysis(report).missing).toContain("verifiable_action");
    expect(assessInterviewReportAnalysis(report).missing).toContain("boundary_or_counterevidence");
  });
  it("does not treat empty analysis headings as evidence even with a concrete action", () => {
    const report = "## 跨回答综合\n\n## 决策影响\n\n## 边界与反例\n\n## 下一步验证建议\n\n独立访谈五位用户，对比三方证据并验证完成时长。";
    expect(assessInterviewReportAnalysis(report).missing).toEqual([
      "cross_answer_synthesis", "decision_implication", "boundary_or_counterevidence",
    ]);
  });
  it("accepts bold analysis labels and concrete validation sections from provider Markdown", () => {
    const report = "## 跨回答综合\n\n共同模式：信息对齐失效。\n\n- **决策影响**：应优先验证安装前确认，暂缓扩展功能。\n- **边界与反例**：标准鞋柜无需增加表单，置信度中等。\n\n## 下一步验证建议\n\n1. **执行三角验证深度访谈**：独立访谈五起延期事件中的用户、师傅和客服，对比三方证据。\n2. **A/B测试**：采集实验组与对照组的返工率和下单转化率。";
    expect(assessInterviewReportAnalysis(report)).toEqual({ ok: true, missing: [] });
  });
  it("does not accept formatting-only labels or quoted code as analysis evidence", () => {
    const report = "## 跨回答综合\n\n共同模式：信息对齐失效。\n\n决策影响：暂缓扩展功能，因为需要证据。\n\n## 下一步验证建议\n\n建议优化产品。\n\n```md\n边界与反例：仍待验证。\nP0：验证真实任务完成时长。\n```";
    expect(assessInterviewReportAnalysis(report).missing).toContain("boundary_or_counterevidence");
    expect(assessInterviewReportAnalysis(report).missing).toContain("verifiable_action");
  });
});


describe("numbered verifiable action headings (#5289)", () => {
  const action = "独立访谈五位用户，对比三方证据并验证任务完成时长。";
  it.each(["6. 下一步验证建议", "六、下一步验证建议", "6. 下一步验证建议（可执行行动）", "六、验证计划(可验证行动)", "行动建议（可执行行动）："])("accepts a concrete action under %s without changing report bytes", (heading) => {
    const report = `## ${heading}\n\n${action}`;
    expect(hasInterviewReportVerifiableAction(report)).toBe(true);
    expect(assessInterviewReportAnalysis(report).missing).not.toContain("verifiable_action");
    expect(report).toContain(heading);
  });
  it.each(["建议优化产品。", "访谈用户。", "测试三次。", "P0：建议优化流程。", "建议行动：建议优化产品流程。", "> 独立访谈五位用户，对比三方证据并验证任务完成时长。", "> P0：独立访谈五位用户，对比三方证据并验证任务完成时长。", "```md\nP0：独立访谈五位用户，对比三方证据并验证任务完成时长。\n```"])("does not let a numbered title or quoted labels manufacture action: %s", (body) => {
    expect(hasInterviewReportVerifiableAction(`## 6. 下一步验证建议（可执行行动）\n\n${body}`)).toBe(false);
  });
  it.each(["answer-1", "source-1"])("does not count controlled %s evidence links as researcher actions", (anchor) => {
    expect(hasInterviewReportVerifiableAction(`## 6. 下一步验证建议\n\n[${action}](#${anchor})`)).toBe(false);
    expect(hasInterviewReportVerifiableAction(`## 6. 下一步验证建议\n\n[${action}](#${anchor})\n\n${action}`)).toBe(true);
  });
  it.each(["6. 下一步验证建议与后续研究", "六、下一步验证建议（可执行行动", "讨论下一步验证建议", "下一步验证建议（可执行行动）与其他事项"])("does not expand the section scope to %s", (heading) => {
    expect(hasInterviewReportVerifiableAction(`## ${heading}\n\n${action}`)).toBe(false);
  });
});


it("rejects arbitrary report stream failure strings at the public boundary", async () => {
  const { InterviewMarkdownReportStreamEvent } = await import("../src/interview-markdown");
  expect(InterviewMarkdownReportStreamEvent.safeParse({ type: "failed", reasonCode: "PRIVATE_PROVIDER_SECRET" }).success).toBe(false);
  expect(InterviewMarkdownReportStreamEvent.safeParse({ type: "failed", reasonCode: "AI_GENERATION_UNAVAILABLE" }).success).toBe(true);
});
