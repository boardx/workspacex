import { research as C } from "@repo/contracts";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GuidedResearchPlanDetails, GuidedResearchRuntimeProgress } from "@/components/research-studio/guided-research-runtime-progress";
import { runtimeFixture } from "../guided-runtime-fixture";

describe("research search recovery progress", () => {
  it("distinguishes processed tasks from successful retrieval when all tasks were attempted", () => {
    const initial = runtimeFixture("research");
    const tasks = Array.from({ length: 15 }, (_, index) => ({
      ...initial.tasks[0]!, id: `task-${index}`, status: index < 6 ? "succeeded" as const : "failed" as const,
    }));
    render(<GuidedResearchRuntimeProgress state={{ ...initial, tasks, busy: false, progress: { stage: "searching", completed: 15, total: 15 } }} />);
    expect(screen.getByRole("status")).toHaveTextContent("已处理 15 / 15 · 成功 6 · 失败 9");
    expect(screen.getByRole("progressbar", { name: "检索成功任务" })).toHaveAttribute("value", "6");
    expect(screen.getByRole("progressbar")).toHaveAttribute("max", "15");
    expect(screen.getByText("9 项检索失败，尚未取得所需资料。")).toBeVisible();
  });

  it("does not count pending and running tasks as processed or failed", () => {
    const initial = runtimeFixture("research");
    const tasks = (["succeeded", "failed", "running", "pending"] as const).map((status, index) => ({ ...initial.tasks[0]!, id: String(index), status }));
    render(<GuidedResearchRuntimeProgress state={{ ...initial, tasks, progress: { stage: "searching", completed: 4, total: 4 } }} />);
    expect(screen.getByRole("status")).toHaveTextContent("已处理 2 / 4 · 成功 1 · 失败 1");
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "1");
  });

  it("preserves report stage progress and pause presentation", () => {
    const initial = runtimeFixture("report");
    render(<GuidedResearchRuntimeProgress state={{ ...initial, busy: false, errorCode: "RESEARCH_WORKFLOW_UNAVAILABLE", progress: { stage: "writing", completed: 2, total: 3 } }} />);
    expect(screen.getByRole("status")).toHaveTextContent("撰写报告章节 · 2 / 3 · 已暂停");
    expect(screen.getByRole("progressbar", { name: "撰写报告章节" })).toHaveAttribute("value", "2");
    expect(screen.queryByText(/项检索失败/)).not.toBeInTheDocument();
  });

  it("shows the original query and each actual attempt with readable failures", () => {
    const initial = runtimeFixture("research");
    const task = { ...initial.tasks[0]!, query: "原始政策查询", attempts: 1, status: "running" as const, errorCode: null,
      searchAttempts: [
        { query: "首次实际查询", status: "failed" as const, errorCode: "SEARCH_TIMEOUT" },
        { query: "改写实际查询", status: "succeeded" as const, errorCode: null },
        { query: "补充实际查询", status: "running" as const, errorCode: null },
      ],
    };
    render(<GuidedResearchPlanDetails state={{ ...initial, tasks: [task] }} errors={{ SEARCH_TIMEOUT: "检索超时，请重试。" }} />);
    expect(screen.getByText("正在检索 · 尝试 3 次")).toBeInTheDocument();
    expect(screen.queryByText("正在检索 · 尝试 1 次")).not.toBeInTheDocument();
    expect(screen.getByText("原始检索词：原始政策查询")).toBeInTheDocument();
    const attempts = within(screen.getByRole("list", { name: "检索尝试历史", hidden: true })).getAllByRole("listitem", { hidden: true });
    expect(attempts).toHaveLength(3);
    expect(attempts[0]).toHaveTextContent("尝试 1 · 检索失败首次实际查询检索超时，请重试。");
    expect(attempts[1]).toHaveTextContent("尝试 2 · 检索成功改写实际查询");
    expect(attempts[2]).toHaveTextContent("尝试 3 · 正在检索补充实际查询");
    expect(screen.queryByText("SEARCH_TIMEOUT")).not.toBeInTheDocument();
  });

  it("explains the automatic attempt limit only for an exhausted failed task", () => {
    const initial = runtimeFixture("research");
    const searchAttempts = Array.from({ length: C.GUIDED_RESEARCH_SEARCH_ATTEMPT_LIMIT }, (_, index) => ({
      query: `实际查询 ${index + 1}`, status: "failed" as const, errorCode: null,
    }));
    const task = { ...initial.tasks[0]!, status: "failed" as const, attempts: 2, errorCode: "UNKNOWN", searchAttempts };
    const { rerender } = render(<GuidedResearchPlanDetails state={{ ...initial, tasks: [task] }} errors={{}} />);
    expect(screen.getByText(`检索失败 · 尝试 ${C.GUIDED_RESEARCH_SEARCH_ATTEMPT_LIMIT} 次`)).toBeInTheDocument();
    expect(screen.getByText("已达自动检索尝试上限，请补充来源或调整研究计划。")).toBeInTheDocument();
    expect(screen.queryByText("任务执行失败，请重试。")).not.toBeInTheDocument();
    rerender(<GuidedResearchPlanDetails state={{ ...initial, tasks: [{ ...task, searchAttempts: searchAttempts.slice(1) }] }} errors={{}} />);
    expect(screen.queryByText(/已达自动检索尝试上限/)).not.toBeInTheDocument();
    rerender(<GuidedResearchPlanDetails state={{ ...initial, tasks: [{ ...task, status: "succeeded", errorCode: null }] }} errors={{}} />);
    expect(screen.queryByText(/已达自动检索尝试上限/)).not.toBeInTheDocument();
  });

  it("does not invent query history for legacy tasks without recorded attempts", () => {
    const initial = runtimeFixture("research");
    render(<GuidedResearchPlanDetails state={{ ...initial, tasks: [{ ...initial.tasks[0]!, status: "failed", attempts: 4 }] }} errors={{}} />);
    expect(screen.getByText("检索失败 · 尝试 4 次")).toBeInTheDocument();
    expect(screen.queryByText("实际检索尝试")).not.toBeInTheDocument();
    expect(screen.getByText(`原始检索词：${initial.tasks[0]!.query}`)).toBeInTheDocument();
  });
});
