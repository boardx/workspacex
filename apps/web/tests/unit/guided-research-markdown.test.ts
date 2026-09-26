import { describe, expect, it } from "vitest";
import {
  parseGuidedResearchMarkdown,
  serializeGuidedResearchMarkdown,
} from "@/lib/guided-research-markdown";

const brief = {
  topic: "中国新能源汽车市场竞争格局",
  goal: "判断未来三年的竞争与投资机会",
  timeRange: "2024–2026",
  region: "中国大陆",
  focus: "市场份额、技术路线、政策和用户需求",
};

describe("guided research Markdown artefacts", () => {
  it("serializes a brief with stable researcher-facing headings", () => {
    const document = serializeGuidedResearchMarkdown({ node: "brief", brief });

    expect(document.title).toBe("研究需求");
    expect(document.markdown).toContain("# 研究需求");
    expect(document.markdown).toContain("## 研究主题\n中国新能源汽车市场竞争格局");
    expect(document.markdown).toContain("## 研究目标\n判断未来三年的竞争与投资机会");
    expect(document.markdown).toContain("## 时间与地区\n2024–2026 · 中国大陆");
    expect(document.markdown).toContain("## 重点关注\n市场份额、技术路线、政策和用户需求");
  });

  it("returns field errors and preserves local Markdown when a required heading is deleted", () => {
    const document = serializeGuidedResearchMarkdown({ node: "brief", brief });
    const markdown = document.markdown.replace("## 研究目标\n判断未来三年的竞争与投资机会\n\n", "");

    const result = parseGuidedResearchMarkdown({ document, markdown });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.markdown).toBe(markdown);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ heading: "研究目标" }),
    ]));
  });

  it("keeps source provenance immutable while presenting a source-research Markdown log", () => {
    const document = serializeGuidedResearchMarkdown({
      node: "research",
      brief,
      tasks: [{ id: "task-1", sectionId: "market", query: "中国新能源汽车 市场份额", status: "succeeded", attempts: 1, errorCode: null }],
      sources: [{ id: "source-1", taskId: "task-1", title: "行业报告", url: "https://example.com/report", content: "市场份额变化", retrievedAt: "2026-09-26T00:00:00.000Z", decision: "accepted" }],
      evidence: [{ questionId: "question-1", sectionId: "market", sourceId: "source-1", quote: "市场份额变化", relevance: "direct" }],
    });

    expect(document.markdown).toContain("# 资料研究");
    expect(document.markdown).toContain("[source:source-1]");
    expect(document.provenance.sourceIds).toEqual(["source-1"]);

    const result = parseGuidedResearchMarkdown({ document, markdown: document.markdown.replace("source-1", "forged-source") });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "immutable_provenance" }),
    ]));
  });

  it("rejects report Markdown that changes a cited source identifier", () => {
    const document = serializeGuidedResearchMarkdown({
      node: "report",
      report: {
        title: "新能源汽车市场研究报告",
        summary: "市场竞争正在加剧。",
        introduction: "研究基于已验证来源。",
        conclusion: "建议持续追踪价格竞争。",
        sections: [{ sectionId: "market", body: "## 市场格局\n份额正在变化 [[source:source-1]]", sourceIds: ["source-1"] }],
      },
    });

    const result = parseGuidedResearchMarkdown({ document, markdown: document.markdown.replace("[[source:source-1]]", "[[source:forged-source]]") });

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "immutable_citation" }),
    ]));
  });
});
