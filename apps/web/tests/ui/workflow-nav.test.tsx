/**
 * /workflows/* 左栏与页标题：用设计 token 的样式渲染（不是挤在一起的裸文本），当前页高亮。
 */
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowNav, WorkflowPage } from "@/components/workflow/workflow-nav";

describe("WorkflowNav / WorkflowPage", () => {
  it("三个入口各自成块、带图标，当前页 aria-current + 高亮样式", () => {
    render(<WorkflowNav active="approvals" />);
    const nav = screen.getByTestId("workflow-nav");
    expect(nav.className).toContain("flex-col");
    const runs = screen.getByTestId("workflow-nav-runs");
    const approvals = screen.getByTestId("workflow-nav-approvals");
    const board = screen.getByTestId("workflow-nav-board");
    expect(runs).toHaveAttribute("href", "/workflows/runs");
    expect(approvals).toHaveAttribute("href", "/workflows/approvals");
    expect(board).toHaveAttribute("href", "/workflows/board");
    expect(approvals).toHaveAttribute("aria-current", "page");
    expect(runs).not.toHaveAttribute("aria-current");
    expect(approvals.className).toContain("bg-card");
    expect(runs.className).toContain("text-muted-foreground");
    for (const a of [runs, approvals, board]) {
      expect(a.className).toContain("flex");
      expect(a.querySelector("svg")).not.toBeNull();
    }
    expect(runs).toHaveTextContent("我的运行");
    expect(approvals).toHaveTextContent("待我审批");
  });

  it("页标题用标题字号档位；无标题时只渲染内容外框", () => {
    const { rerender } = render(<WorkflowPage title="待我审批"><p>body</p></WorkflowPage>);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("待我审批");
    expect(h1.className).toContain("text-20");
    rerender(<WorkflowPage><p>body</p></WorkflowPage>);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByTestId("workflow-page")).toHaveTextContent("body");
  });
});
