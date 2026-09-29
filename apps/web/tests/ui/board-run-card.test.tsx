/**
 * CT10 —— Board 运行卡 UI（契约束 work-content ① UI §二；V7 / E10）。
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BoardWorkflowRunCard } from "@repo/contracts/work-content";
import { BoardRunCard, BoardRunColumns, type BoardRunCardData } from "@/components/work-stack/board-run-card";

function card(over: Partial<BoardRunCardData> = {}): BoardRunCardData {
  return BoardWorkflowRunCard.parse({
    id: "workflow_run:wi-1",
    sourceKind: "workflow_run",
    instanceId: "wi-1",
    title: "线索到合格商机 · Acme 公司",
    instanceStatus: "running",
    column: "in_progress",
    badge: "in_progress",
    initiatorUserId: "u-alice",
    agents: [
      { agentId: "ag-sales", digitalHumanId: null, displayName: "销售助理", avatarUrl: null },
      { agentId: "ag-research", digitalHumanId: null, displayName: "研究员", avatarUrl: null },
    ],
    draggable: false,
    href: "/workflows/runs/wi-1",
    ...over,
  });
}

describe("BoardRunCard", () => {
  it("渲染图标、标题、Agent 头像叠放与徽标；不可拖动；点击跳实例详情", () => {
    const onOpen = vi.fn();
    render(<BoardRunCard card={card()} onOpen={onOpen} />);
    const el = screen.getByTestId("board-run-card-wi-1");
    expect(el.getAttribute("draggable")).toBe("false");
    expect(within(el).getByTestId("board-run-card-icon")).toBeTruthy();
    expect(within(el).getByTestId("board-run-card-title").textContent).toBe("线索到合格商机 · Acme 公司");
    expect(within(el).getByTestId("board-run-card-agents").children).toHaveLength(2);
    expect(within(el).getByTestId("board-run-card-badge").textContent).toBe("进行中");
    fireEvent.click(el);
    expect(onOpen).toHaveBeenCalledWith("/workflows/runs/wi-1");
  });

  it.each([
    ["awaiting_review", "待审批"],
    ["done", "完成"],
    ["rejected", "已驳回"],
    ["failed", "失败"],
  ] as const)("徽标 %s → %s（不渲染原始码）", (badge, label) => {
    render(<BoardRunCard card={card({ badge, column: badge === "awaiting_review" ? "review" : "done" })} />);
    const b = screen.getByTestId("board-run-card-badge");
    expect(b.textContent).toBe(label);
    expect(b.textContent).not.toContain(badge);
  });

  it("A1 无 Agent 时显示发起人占位头像", () => {
    render(<BoardRunCard card={card({ agents: [] })} />);
    expect(screen.getByTestId("board-run-card-agents").children).toHaveLength(1);
  });
});

describe("BoardRunColumns", () => {
  it("按列分组，失败终态在 done 列；未给出的（无权限）卡不渲染且不计数", () => {
    const cards = [
      card(),
      card({ id: "workflow_run:wi-2", instanceId: "wi-2", column: "review", badge: "awaiting_review", instanceStatus: "awaiting_gate_decision" }),
      card({ id: "workflow_run:wi-3", instanceId: "wi-3", column: "done", badge: "failed", instanceStatus: "failed" }),
    ];
    render(<BoardRunColumns cards={cards} />);
    expect(within(screen.getByTestId("board-run-column-done")).getByTestId("board-run-card-wi-3")).toBeTruthy();
    expect(screen.getByTestId("board-run-column-count-review").textContent).toBe("1");
    expect(screen.getByTestId("board-run-column-count-done").textContent).toBe("1");
    expect(screen.queryByTestId("board-run-card-wi-hidden")).toBeNull();
    expect(document.querySelectorAll("[draggable='true']")).toHaveLength(0);
  });
});
