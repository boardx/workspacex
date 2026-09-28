import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InterviewReportStep } from "@/components/itv/interview-report-step";
import { InterviewMarkdownResultsStep } from "@/components/itv/interview-markdown-results-step";
import * as exports from "@/lib/interview-report-export";
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("export failure keeps the document visible and provides an error", async () => {
  vi.spyOn(exports, "exportInterviewReportWord").mockRejectedValue(new Error("download unavailable"));
  render(<InterviewReportStep document={{ documentId: "report-1", step: "report", version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [], markdown: "# 保留报告\n\n原文内容。" }} />);
  fireEvent.click(screen.getByRole("button", { name: "导出 Word" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("导出未完成");
  expect(screen.getByText("原文内容。")).toBeVisible();
});
it("report directory matches source headings including the final section", () => {
  render(<InterviewReportStep document={{ documentId: "report-1", step: "report", version: 2, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [], markdown: "# 夜班研究\n\n## 发现\n\n原始材料。\n\n## 最后附录\n\n最终证据。" }} />);
  expect(screen.getByRole("link", { name: "最后附录" })).toHaveAttribute("href", "#section-3");
  expect(screen.getByRole("heading", { name: "最后附录" })).toHaveAttribute("id", "section-3");
  expect(screen.getByText("最终证据。")).toBeVisible();
  expect(screen.queryByRole("button", { name: "批准报告" })).not.toBeInTheDocument();
});
it("keeps trusted simulation and unapproved-version disclosure inside the printable report", () => {
  render(<InterviewReportStep document={{ documentId: "report-1", step: "report", version: 2, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [], markdown: "# 报告" }} />);
  const boundary = screen.getByTestId("itv-source-report-evidence-boundary");
  expect(boundary.closest("#itv-source-report-print")).not.toBeNull();
  expect(boundary).not.toHaveClass("print:hidden");
  expect(boundary).toHaveTextContent("不代表真实用户证据");
  expect(boundary).toHaveTextContent("不代表已批准结论");
});
it("derives report metrics only from saved experts, completed tasks and explicit Markdown list items", () => {
  render(<InterviewReportStep
    document={{ documentId: "report-2", step: "report", version: 3, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [], markdown: "# 研究报告\n\n## 核心发现\n\n- 决策链不透明。\n\n### 预算边界\n\n- 预算否决者待核实。\n\n## 建议行动\n\n- P0：复核审批记录。" }}
    expertsDocument={{ documentId: "experts-2", step: "experts", version: 1, contentHash: "b".repeat(64), evidenceMode: "simulated", references: [], markdown: "## [采购角色](#expert-purchase)\n\n模拟画像。\n\n## [财务角色](#expert-finance)\n\n模拟画像。" }}
    execution={{ status: "completed", tasks: [{ expertId: "purchase", status: "completed", errorCode: null }, { expertId: "finance", status: "failed", errorCode: "MODEL_UNAVAILABLE" }] }} reportStatus="completed" />);
  expect(screen.getByTestId("itv-report-metric-experts")).toHaveTextContent("2");
  expect(screen.getByTestId("itv-report-metric-completed")).toHaveTextContent("1");
  expect(screen.getByTestId("itv-report-metric-findings")).toHaveTextContent("2");
  expect(screen.getByTestId("itv-report-metric-actions")).toHaveTextContent("1");
  expect(screen.getByTestId("itv-report-metrics")).toHaveTextContent("模拟任务，不代表真人样本");
});
it("labels unstructured or partial report metrics without inventing entries", () => {
  render(<InterviewReportStep document={{ documentId: "report-3", step: "report", version: 1, contentHash: "c".repeat(64), evidenceMode: "simulated", references: [], markdown: "# 未完成报告\n\n## 核心发现\n\n暂无明确发现。\n\n## 建议行动\n\n| 优先级 | 动作 |\n| --- | --- |\n| P0 | 待验证 |" }} reportStatus="failed" />);
  expect(screen.getByTestId("itv-report-metric-findings")).toHaveTextContent("0");
  expect(screen.getByTestId("itv-report-metric-actions")).toHaveTextContent("0");
  expect(screen.getByTestId("itv-report-metrics")).toHaveTextContent("未完成");
  expect(screen.getByTestId("itv-report-metrics")).toHaveTextContent("正文或表格未计入条目数");
});
it("counts a finding once when supporting evidence is a nested list", () => {
  render(<InterviewReportStep document={{ documentId: "nested-report", step: "report", version: 1, contentHash: "d".repeat(64), evidenceMode: "simulated", references: [], markdown: "# 报告\n\n## 核心发现\n\n- 一项发现\n  - 证据 A\n  - 证据 B\n\n### 更多发现\n\n- 另一项发现\n\n## 建议行动\n\n1. 一项行动\n   - 检查步骤" }} />);
  expect(screen.getByTestId("itv-report-metric-findings")).toHaveTextContent("2");
  expect(screen.getByTestId("itv-report-metric-actions")).toHaveTextContent("1");
});
it("uses saved legacy workflow metadata instead of displaying false zero counts", () => {
  render(<InterviewReportStep
    document={{ documentId: "legacy-report", step: "report", version: 1, contentHash: "e".repeat(64), evidenceMode: "simulated", references: [], markdown: "# 旧报告" }}
    expertsDocument={{ documentId: "legacy-experts", step: "experts", version: 1, contentHash: "f".repeat(64), evidenceMode: "simulated", references: [], markdown: "# 专家画像\n\n## 1\n\n### name\n\n```text\n研究员\n```" }}
    legacySelectedExpertIds={["expert-1", "expert-2"]}
    legacyRuns={[{ expertId: "expert-1", status: "completed" }, { expertId: "expert-2", status: "failed" }]} />);
  expect(screen.getByTestId("itv-report-metric-experts")).toHaveTextContent("2");
  expect(screen.getByTestId("itv-report-metric-completed")).toHaveTextContent("1");
});
it("report route reads persisted Markdown instead of a legacy JSON report", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100"); vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ interviewId: "report-study", revisionId: "revision-1", version: 3, documents: [{ documentId: "report-1", step: "report", version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [], markdown: "# 夜班研究\n\n## 保留材料\n\n失败前已保存的原文。" }], states: [{ documentId: "report-1", status: "failed", failure: { code: "AI_GENERATION_UNAVAILABLE", retryable: true } }] })));
  render(<InterviewMarkdownResultsStep interviewId="report-study" step="report" runs={[]} onVersionChange={vi.fn()} onReport={vi.fn()} />);
  expect(await screen.findByText("失败前已保存的原文。")).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("不代表完整报告");
});
