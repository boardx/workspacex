/**
 * /workflows/* 左栏与页标题：用设计 token 的样式渲染（不是挤在一起的裸文本），当前页高亮。
 */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowNav, WorkflowPage } from "@/components/workflow/workflow-nav";
import { TOP_LEVEL_NAV_ITEMS } from "@/lib/navigation";

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", async (orig) => ({ ...((await orig()) as object), redirect: redirectMock }));

describe("工作流主导航入口 + /workflows 落地", () => {
  it("主导航有「工作流」一级入口指向 /workflows；/workflows 重定向到我的运行", async () => {
    const item = TOP_LEVEL_NAV_ITEMS.find((i) => i.key === "workflows");
    expect(item?.label).toBe("工作流");
    expect(item?.href).toBe("/workflows");
    const { default: Landing } = await import("@/app/workflows/page");
    Landing();
    expect(redirectMock).toHaveBeenCalledWith("/workflows/runs");
  });
});

describe("WorkflowNav / WorkflowPage", () => {
  it("从项目进入（带 projectId）时左栏顶部有「返回项目」，全局视图没有", () => {
    const { rerender } = render(<WorkflowNav active="board" projectId="p 1" />);
    const back = screen.getByTestId("workflow-nav-back-to-project");
    expect(back).toHaveAttribute("href", "/projects/p%201");
    expect(back).toHaveTextContent("返回项目");
    rerender(<WorkflowNav active="board" />);
    expect(screen.queryByTestId("workflow-nav-back-to-project")).toBeNull();
  });

  it("项目视图下三个入口都带 projectId，退路不丢", () => {
    render(<WorkflowNav active="runs" projectId="p 1" />);
    expect(screen.getByTestId("workflow-nav-runs")).toHaveAttribute("href", "/workflows/runs?projectId=p%201");
    expect(screen.getByTestId("workflow-nav-approvals")).toHaveAttribute("href", "/workflows/approvals?projectId=p%201");
    expect(screen.getByTestId("workflow-nav-board")).toHaveAttribute("href", "/workflows/board?projectId=p%201");
  });

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
