import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InterviewReportStep } from "@/components/itv/interview-report-step";
import { InterviewMarkdownResultsStep } from "@/components/itv/interview-markdown-results-step";
import * as exports from "@/lib/interview-report-export";
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("lets a small-screen reader collapse the directory without losing section links", () => {
  render(<InterviewReportStep document={{ documentId: "mobile-report", step: "report", version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [], markdown: "# 教育研究\n\n## 发现\n\n正文。" }} />);
  const toggle = screen.getByRole("button", { name: "展开目录" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle);
  expect(screen.getByRole("button", { name: "收起目录" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("link", { name: "发现" })).toHaveAttribute("href", "#section-2");
});
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
it("report route reads persisted Markdown instead of a legacy JSON report", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100"); vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ interviewId: "report-study", revisionId: "revision-1", version: 3, documents: [{ documentId: "report-1", step: "report", version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [], markdown: "# 夜班研究\n\n## 保留材料\n\n失败前已保存的原文。" }], states: [{ documentId: "report-1", status: "failed", failure: { code: "AI_GENERATION_UNAVAILABLE", retryable: true } }] })));
  render(<InterviewMarkdownResultsStep interviewId="report-study" step="report" runs={[]} onVersionChange={vi.fn()} onReport={vi.fn()} />);
  expect(await screen.findByText("失败前已保存的原文。")).toBeVisible();
  expect(screen.queryByRole("region", { name: "报告人工复核" })).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("不代表完整报告");
});

it("shows the saved report directly without duplicate notices, stats or review", () => {
  const markdown = "# 研究报告\n\n## 发现\n\n原文模拟边界与证据仍保留。";
  render(<InterviewReportStep document={{ documentId: "simple-report", step: "report", version: 3, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [], markdown }} reportStatus="failed" />);
  expect(screen.getByText("原文模拟边界与证据仍保留。")).toBeVisible();
  expect(screen.getByRole("link", { name: "发现" })).toHaveAttribute("href", "#section-2");
  for (const id of ["itv-report-details", "itv-report-metrics", "itv-report-quality", "itv-source-report-evidence-boundary"]) expect(screen.queryByTestId(id)).not.toBeInTheDocument();
  expect(screen.queryByText("报告人工复核")).not.toBeInTheDocument();
  expect(markdown).toBe("# 研究报告\n\n## 发现\n\n原文模拟边界与证据仍保留。");
});

it("keeps report version and hash in the PDF print root without adding screen clutter", () => {
  render(<InterviewReportStep document={{ documentId: "print-version", step: "report", version: 7, contentHash: "b".repeat(64), evidenceMode: "simulated", references: [], markdown: "# 原文" }} />);
  const version = screen.getByTestId("itv-report-print-version");
  expect(version.closest("#itv-source-report-print")).not.toBeNull();
  expect(version).toHaveClass("hidden", "print:block");
  expect(version).toHaveTextContent(`文档版本 7 · SHA256 ${"b".repeat(64)}`);
});


it.each(["simulated", "participant"] as const)("retains export disclosures inside the print root (%s)", (evidenceMode) => {
  render(<InterviewReportStep document={{ documentId: "print-provenance", step: "report", version: 7, contentHash: "b".repeat(64), evidenceMode, references: [], markdown: "# 原文报告" }} />);
  const root = document.getElementById("itv-source-report-print")!;
  expect(root.textContent).toContain("文档版本 7");
  expect(root.textContent).toContain("b".repeat(64));
  expect(root.textContent).toContain("不代表已批准结论");
  if (evidenceMode === "simulated") expect(root.textContent).toContain("不代表真实用户证据");
  else expect(root.textContent).not.toContain("不代表真实用户证据");
  expect(screen.getByTestId("itv-report-print-provenance")).toHaveClass("hidden", "print:block");
});
