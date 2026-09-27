import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InterviewReportStep } from "@/components/itv/interview-report-step";
import { InterviewMarkdownResultsStep } from "@/components/itv/interview-markdown-results-step";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
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
  expect(screen.getByRole("alert")).toHaveTextContent("不代表完整报告");
});
