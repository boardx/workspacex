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
it("report route reads persisted Markdown instead of a legacy JSON report", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100"); vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ interviewId: "report-study", revisionId: "revision-1", version: 3, documents: [{ documentId: "report-1", step: "report", version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [], markdown: "# 夜班研究\n\n## 保留材料\n\n失败前已保存的原文。" }], states: [{ documentId: "report-1", status: "failed", failure: { code: "AI_GENERATION_UNAVAILABLE", retryable: true } }] })));
  render(<InterviewMarkdownResultsStep interviewId="report-study" step="report" runs={[]} onVersionChange={vi.fn()} onReport={vi.fn()} />);
  expect(await screen.findByText("失败前已保存的原文。")).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("不代表完整报告");
});
