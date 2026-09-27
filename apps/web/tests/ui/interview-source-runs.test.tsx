import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InterviewRunsStep } from "@/components/itv/interview-runs-step";
afterEach(cleanup);
it("progress uses persisted counters while summary retains Markdown attribution", () => {
  render(<InterviewRunsStep runs={[{ expertId: "nurse-7", displayName: "护理模拟角色", status: "running", completedQuestions: 2, totalQuestions: 4 }]} document={{ documentId: "runs-1", step: "runs", version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [], markdown: "## 护理模拟角色\n\n> 最近一次交接班遗漏发生在夜班。\n\n来源：[问题七](#question-q7)" }} pending={false} onGenerateReport={vi.fn()} />);
  expect(screen.getByRole("progressbar", { name: "访谈整体进度" })).toHaveAttribute("aria-valuenow", "50");
  expect(screen.getByText("最近一次交接班遗漏发生在夜班。")).toBeVisible();
  expect(screen.getByRole("link", { name: "问题七" })).toHaveAttribute("href", "#question-q7");
  expect(screen.getByRole("button", { name: "汇总报告" })).toBeDisabled();
});
