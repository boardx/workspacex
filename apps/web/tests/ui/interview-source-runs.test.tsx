import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InterviewRunsStep } from "@/components/itv/interview-runs-step";
afterEach(cleanup);
it("queued experts are not presented as actively interviewing", () => {
  render(<InterviewRunsStep runs={[{ expertId: "queued-7", displayName: "待访谈专家", status: "pending", completedQuestions: 0, totalQuestions: 1 }]} pending={false} onGenerateReport={vi.fn()} />);
  expect(screen.getByText("等待访谈 · 0/1")).toBeVisible();
  expect(screen.queryByText("进行中 · 0/1")).not.toBeInTheDocument();
});
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
it("execution task progress counts experts and distinguishes each persisted state", () => {
  render(<InterviewRunsStep runs={[
    { expertId: "finished", displayName: "完成专家", status: "completed", completedQuestions: 1, totalQuestions: 1 },
    { expertId: "active", displayName: "进行专家", status: "running", completedQuestions: 0, totalQuestions: 1 },
    { expertId: "queued", displayName: "排队专家", status: "pending", completedQuestions: 0, totalQuestions: 1 },
    { expertId: "failed", displayName: "失败专家", status: "failed", completedQuestions: 0, totalQuestions: 1 },
  ]} taskProgress pending={false} onGenerateReport={vi.fn()} />);
  expect(screen.getByText(/^已完成专家 1\/4/u)).toBeVisible();
  expect(screen.getByRole("progressbar", { name: "访谈整体进度" })).toHaveAttribute("aria-valuenow", "25");
  expect(screen.getByText("进行中 1")).toBeVisible();
  expect(screen.getByText("等待访谈 1")).toBeVisible();
  expect(screen.getByText("执行失败 1")).toBeVisible();
  expect(screen.getByText("已完成 1")).toBeVisible();
  expect(screen.queryByText("已完成 · 1/1")).not.toBeInTheDocument();
});
it("only projects saved Markdown insight sections and preserves source attribution", () => {
  const markdown = "# 模拟访谈摘要\n\n## [采购专家](#expert-purchase)\n\n### 关键观点\n\n- [采购审批至少经过两级](#question-q1)\n\n### 争议点与风险\n\n- 预算否决人身份待核实。\n\n## [技术专家](#expert-tech)\n\n### 核心发现\n\n- 技术评审需要安全确认。";
  render(<InterviewRunsStep runs={[
    { expertId: "purchase", displayName: "采购专家", status: "completed", completedQuestions: 1, totalQuestions: 1 },
    { expertId: "tech", displayName: "技术专家", status: "completed", completedQuestions: 1, totalQuestions: 1 },
  ]} document={{ documentId: "runs-grouped", step: "runs", version: 2, contentHash: "c".repeat(64), evidenceMode: "simulated", references: [], markdown }} pending={false} onGenerateReport={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "关键观点（1）" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "争议点与风险（1）" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "核心发现（1）" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: /后续追问/u })).not.toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "采购审批至少经过两级" })[0]).toHaveAttribute("href", "#question-q1");
  fireEvent.click(screen.getByRole("tab", { name: "采购专家" }));
  expect(screen.getByRole("heading", { name: "关键观点（1）" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "核心发现（1）" })).not.toBeInTheDocument();
});
