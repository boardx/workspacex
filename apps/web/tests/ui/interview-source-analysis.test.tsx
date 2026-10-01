import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InterviewAnalysisStep } from "@/components/itv/interview-analysis-step";
afterEach(cleanup);
it("analysis cards retain canonical source links and Markdown lists", () => {
  render(<InterviewAnalysisStep document={{ documentId: "analysis-1", step: "analysis", version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [], markdown: "# 分析\n\n## 研究范围\n\n- 依据[需求来源](#source-intake)核对夜班场景。\n\n## AI 建议\n\n- 继续询问[交接问题](#question-q7)。" }} pending={false} onGenerate={vi.fn()} onConfirm={vi.fn()} />);
  expect(screen.getByRole("link", { name: "需求来源" })).toHaveAttribute("href", "#source-intake");
  expect(screen.getByRole("link", { name: "交接问题" })).toHaveAttribute("href", "#question-q7");
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
});
