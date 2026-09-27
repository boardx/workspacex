import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InterviewRunsStep } from "@/components/itv/interview-runs-step";
afterEach(cleanup);
it("expert summary tabs filter by stable attribution while keeping question links", () => {
  render(<InterviewRunsStep runs={[
    { expertId: "nurse-7", displayName: "护理角色", status: "completed", completedQuestions: 1, totalQuestions: 1 },
    { expertId: "doctor-8", displayName: "医生角色", status: "running", completedQuestions: 0, totalQuestions: 1 },
  ]} document={{ documentId: "runs-2", step: "runs", version: 1, contentHash: "b".repeat(64), evidenceMode: "simulated", references: [], markdown: "# 访谈汇总\n\n## [护理角色](#expert-nurse-7)\n\n交接记录需要复核。[追问](#question-q7)\n\n## [医生角色](#expert-doctor-8)\n\n急诊分诊尚未回答。" }} pending={false} onGenerateReport={vi.fn()} />);
  fireEvent.click(screen.getByRole("tab", { name: "护理角色" }));
  expect(screen.getByText(/交接记录需要复核/)).toBeVisible();
  expect(screen.queryByText("急诊分诊尚未回答。")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "追问" })).toHaveAttribute("href", "#question-q7");
  fireEvent.click(screen.getByRole("tab", { name: "全部（实时汇总）" }));
  expect(screen.getByText("急诊分诊尚未回答。")).toBeVisible();
});
it("progress uses persisted counters while summary retains Markdown attribution", () => {
  render(<InterviewRunsStep runs={[{ expertId: "nurse-7", displayName: "护理模拟角色", status: "running", completedQuestions: 2, totalQuestions: 4 }]} document={{ documentId: "runs-1", step: "runs", version: 1, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [], markdown: "## 护理模拟角色\n\n> 最近一次交接班遗漏发生在夜班。\n\n来源：[问题七](#question-q7)" }} pending={false} onGenerateReport={vi.fn()} />);
  expect(screen.getByRole("progressbar", { name: "访谈整体进度" })).toHaveAttribute("aria-valuenow", "50");
  expect(screen.getByText("最近一次交接班遗漏发生在夜班。")).toBeVisible();
  expect(screen.getByRole("link", { name: "问题七" })).toHaveAttribute("href", "#question-q7");
  expect(screen.getByRole("button", { name: "汇总报告" })).toBeDisabled();
});
