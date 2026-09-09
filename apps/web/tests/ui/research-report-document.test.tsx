import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { researchReportDocument, researchReportMarkdown } from "@/lib/research-report-document";
import { GuidedResearchReportDocument } from "@/components/research-studio/guided-research-report-document";
import { GuidedResearchReportPreview } from "@/components/research-studio/guided-research-report-preview";
import { runtimeFixture } from "../guided-runtime-fixture";
const runtime = runtimeFixture("report");
const source = runtime.sources[0]!;
const sources = [source,
  { ...source, id: "alias", url: "https://EXAMPLE.org:443/policy#details", title: "Same document" },
  { ...source, id: "second", url: "https://example.org/second", title: "Second source" },
  { ...source, id: "excluded", url: "https://example.org/excluded", decision: "excluded" as const },
  { ...source, id: "pending", url: "https://example.org/pending", decision: "pending" as const },
  { ...source, id: "unsafe", url: "javascript:alert(1)" },
];
describe("research chapter document", () => {
  it("numbers first appearance in reader order and shares a number across normalized duplicate URLs", () => {
    const document = researchReportDocument({ title: "报告", summary: "摘要[[source:second]]", sections: [{ sectionId: "o1", body: "结论[[source:source1]]，补充[[source:alias]]。再述[[source:second]]", sourceIds: ["source1", "alias", "second"] }] }, sources, runtime.outline);
    expect(document.references.map((item) => [item.number, item.url])).toEqual([[1, "https://example.org/second"], [2, "https://example.org/policy"]]);
    render(<GuidedResearchReportDocument document={document} />);
    expect(screen.getAllByTestId("research-inline-citation").map((link) => link.textContent)).toEqual(["1", "2", "2", "1"]);
    expect(screen.getAllByTestId("research-inline-citation").every((link) => link.parentElement?.tagName === "SUP")).toBe(true);
    expect(within(screen.getByTestId("research-report-references")).getAllByRole("listitem")).toHaveLength(2);
  });
  it("renders rich Markdown headings, lists and a table without rendering model HTML or unsafe links", () => {
    const document = researchReportDocument({ title: "Report", summary: "", sections: [{ sectionId: "o1", body: '### 核心分析\n\n- **政策变化**[[source:source1]]\n- 第二项\n\n| 国家 | 机会 |\n| --- | --- |\n| 德国 | 增长 |\n\n<script>alert(1)</script>\n\n[危险](javascript:alert)\n\n<img src=x onerror=alert(1)>', sourceIds: ["source1"] }] }, sources, runtime.outline);
    const { container } = render(<GuidedResearchReportDocument document={document} />);
    expect(screen.getByRole("heading", { name: "核心分析" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("德国");
    expect(container.querySelector("strong")).toHaveTextContent("政策变化");
    expect(container.querySelectorAll("script,img")).toHaveLength(0);
    expect(screen.getByText("危险").closest("a")).toBeNull();
  });
  it("preserves citation syntax in code examples without adding unused references", () => {
    const body = '正文[[source:source1]]\n\n`[[source:second]]`\n\n```text\n[[source:second]]\n```\n\n~~~text\n[[source:second]]\n~~~';
    const document = researchReportDocument({ title: "Report", summary: "", sections: [{ sectionId: "o1", body }] }, sources, runtime.outline);
    expect(document.references).toHaveLength(1);
    render(<GuidedResearchReportDocument document={document} />);
    expect(screen.getAllByTestId("research-inline-citation")).toHaveLength(1);
    expect(screen.getAllByText("[[source:second]]")).toHaveLength(3);
    expect(researchReportMarkdown(document)).toContain('`[[source:second]]`');
  });
  it("never links unknown, excluded, pending, or unsafe source markers", () => {
    const document = researchReportDocument({ title: "Report", summary: "[[source:excluded]][[source:pending]][[source:unsafe]][[source:missing]]", sections: [] }, sources, runtime.outline);
    expect(document.references).toHaveLength(0);
    render(<GuidedResearchReportDocument document={document} />);
    expect(screen.queryByTestId("research-inline-citation")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link").every((link) => link.getAttribute("href")?.startsWith("#"))).toBe(true);
    expect(screen.getByText(/来源不可用/)).toBeInTheDocument();
  });
  it("keeps legacy section source IDs as superscripts and exports the exact same numbering", () => {
    const document = researchReportDocument({ title: "报告", summary: "摘要", sections: [{ sectionId: "o1", body: "旧版结论", sourceIds: ["source1", "alias", "excluded", "second"] }] }, sources, runtime.outline);
    render(<GuidedResearchReportDocument document={document} />);
    expect(screen.getAllByTestId("research-inline-citation").map((link) => link.textContent)).toEqual(["1", "2"]);
    const markdown = researchReportMarkdown(document, true);
    expect(markdown).toContain("本节来源 [^1] [^2]");
    expect(markdown).toContain("[^1]: [Official policy](<https://example.org/policy>)");
    expect(markdown).toContain("[^2]: [Second source](<https://example.org/second>)");
    expect(markdown).toContain("证据可能存在缺口");
    expect(markdown).not.toContain("excluded");
  });
  it("restores streamed chapters before synthesis and keeps provisional references separate from final controls", () => {
    const state = { ...runtime, report: null, reportStream: { requestId: "req", sequence: 9, status: "streaming" as const, text: '{"sections":[{"sectionId":"o1","body":"### 已生成章节\\n\\n结论[[source:source1]]","sourceIds":["source1"]}],"title":"研究报告","summary":"正在综合' } };
    render(<GuidedResearchReportPreview state={state} />);
    expect(screen.getByRole("heading", { name: "已生成章节" })).toBeInTheDocument();
    expect(screen.getByText("正在综合")).toBeInTheDocument();
    expect(screen.getByTestId("research-report-validation-status")).toHaveTextContent("已显示 1 个章节，保存状态正在同步");
    expect(screen.getByTestId("research-report-validation-status")).toHaveTextContent("尚未完成");
    expect(screen.getByTestId("research-inline-citation")).toHaveAttribute("href", source.url);
    expect(screen.getByTestId("research-report-preview")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "下载 Word" })).toBeEnabled();
    expect(screen.getByText(/当前导出为未完成草稿/)).toBeInTheDocument();
  });
});
