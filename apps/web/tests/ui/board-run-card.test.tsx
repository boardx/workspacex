/**
 * CT10 —— Board 运行卡 UI（契约束 work-content ① UI §二；V7 / E10）。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TabTodo } from "@/components/project/tab-todo";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { describe, expect, it, vi } from "vitest";
import { BoardWorkflowRunCard } from "@repo/contracts/work-content";
import { BoardRunCard, BoardRunColumns, LiveBoardRunColumns, type BoardRunCardData } from "@/components/work-stack/board-run-card";
import * as api from "@/lib/api-client";
import { listBoardRunCards } from "@/lib/board-run-cards-api";

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
      { agentId: "ag-sales", digitalHumanId: "D005", displayName: "销售助理", avatarKey: "person-7", avatarUrl: null },
      { agentId: "ag-research", digitalHumanId: null, displayName: "研究员", avatarKey: null, avatarUrl: null },
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

  it("Agent 头像：有插画 key 渲染插画、否则首字母", () => {
    render(<BoardRunCard card={card()} />);
    const avatars = screen.getByTestId("board-run-card-agents").children;
    expect(avatars[0]!.getAttribute("data-avatar-key")).toBe("person-7");
    expect(avatars[1]!.getAttribute("data-avatar-key")).toBeNull();
    expect(avatars[1]!.textContent).toBe("研究");
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

describe("LiveBoardRunColumns（接真实 API 客户端）", () => {
  it("项目视图把 projectId 传给加载器并渲染服务端给出的卡", async () => {
    const load = vi.fn(async () => ({ cards: [card()] }));
    render(<LiveBoardRunColumns projectId="p-1" load={load} />);
    expect(await screen.findByTestId("board-run-card-wi-1")).toBeTruthy();
    expect(load).toHaveBeenCalledWith("p-1");
  });

  it("全局视图传 null；加载失败只给通用文案", async () => {
    const load = vi.fn(async () => { throw new Error("secret_reason_code"); });
    render(<LiveBoardRunColumns load={load} />);
    await waitFor(() => expect(screen.getByTestId("board-run-cards-error")).toBeTruthy());
    expect(load).toHaveBeenCalledWith(null);
    expect(document.body.textContent).not.toContain("secret_reason_code");
  });

  it("listBoardRunCards 走契约路径并按 out schema 校验", async () => {
    const spy = vi.spyOn(api, "apiRequest").mockResolvedValue({ cards: [card()] } as never);
    const out = await listBoardRunCards("p-1");
    expect(spy).toHaveBeenCalledWith("/board/workflow-run-cards", { query: { projectId: "p-1" } });
    expect(out.cards[0]!.id).toBe("workflow_run:wi-1");
    spy.mockRestore();
  });
});

describe("任务 Board（项目待办看板）合并运行卡", () => {
  it("服务端 columns 里的运行卡 ID 渲染为只读运行卡，与任务卡同列", async () => {
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok");
    const task = { id: "t-1", title: "任务 t-1", status: "review", sourceKind: "手工创建", ownerUserId: "u1", executor: null, dueAt: null,
      riskLevel: null, waitingOn: null, syncStatus: "synced", projectId: "p1" };
    const run = card({ column: "review", badge: "awaiting_review", instanceStatus: "awaiting_gate_decision" });
    const body = {
      cards: [task], runCards: [run], scope: "project",
      columns: [{ status: "todo", cardIds: [] }, { status: "in_progress", cardIds: [] }, { status: "review", cardIds: ["t-1", run.id] }, { status: "done", cardIds: [] }],
      collapsedInboxCount: 0, badgeCount: 1, footer: { overdue: 0, dueToday: 0 }, noCardLoss: true,
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })));
    render(<TabTodo view="facilitator" projectId="p1" />);
    const col = await screen.findByTestId("project-todo-column-review");
    expect(within(col).getByTestId("project-todo-card-t-1")).toBeTruthy();
    const runEl = within(col).getByTestId("board-run-card-wi-1");
    expect(runEl.getAttribute("draggable")).toBe("false");
    expect(within(runEl).getByTestId("board-run-card-badge").textContent).toBe("待审批");
    expect(col.textContent).toContain("2");
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });
});
