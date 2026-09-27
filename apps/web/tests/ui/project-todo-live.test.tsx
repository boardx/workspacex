/**
 * 项目中枢 B2-S2 —— 待办看板读真实任务板 `GET /tasks?projectId=&scope=project`。
 * 钉住：列由服务端 `columns` 决定、卡片按 `cardIds` 归列 / 空板如实空态 / 观察者只挂说明条且不发请求 /
 * 403 如实显示、不显示内部错误码。只 mock 网络边界。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { TabTodo } from "@/components/project/tab-todo";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const card = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, title: `任务 ${id}`, status, sourceKind: "manual", ownerUserId: "u1", executor: null, dueAt: null,
  riskLevel: null, waitingOn: null, syncStatus: "synced", projectId: "p1", ...extra,
});
const BOARD = {
  cards: [card("a", "todo", { riskLevel: "R2" }), card("b", "in_progress", { executor: { kind: "agent", id: "研究员" } }), card("c", "done")],
  scope: "project",
  columns: [
    { status: "todo", cardIds: ["a"] }, { status: "in_progress", cardIds: ["b"] },
    { status: "review", cardIds: [] }, { status: "done", cardIds: ["c"] },
  ],
  collapsedInboxCount: 0, badgeCount: 1, footer: { overdue: 0, dueToday: 1 }, noCardLoss: true,
};

describe("B2-S2 待办看板：真实任务板", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("按服务端 columns 分列渲染真实卡片，请求带 projectId 与 scope=project", async () => {
    const fetchMock = vi.fn(async () => json(BOARD));
    vi.stubGlobal("fetch", fetchMock);
    render(<TabTodo view="facilitator" projectId="p1" />);
    await screen.findByTestId("project-todo-board");
    expect(screen.getByTestId("project-todo-column-todo")).toContainElement(screen.getByTestId("project-todo-card-a"));
    expect(screen.getByTestId("project-todo-column-in_progress")).toContainElement(screen.getByTestId("project-todo-card-b"));
    expect(screen.getByTestId("project-todo-column-done")).toContainElement(screen.getByTestId("project-todo-card-c"));
    expect(screen.getByTestId("project-todo-card-b")).toHaveTextContent("研究员 在跑");
    expect(screen.queryByTestId("project-todo-empty")).toBeNull();
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.pathname).toBe("/tasks");
    expect(url.searchParams.get("projectId")).toBe("p1");
    expect(url.searchParams.get("scope")).toBe("project");
  });

  it("空板 ⇒ 如实空态", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...BOARD, cards: [], columns: BOARD.columns.map((c) => ({ ...c, cardIds: [] })) })));
    render(<TabTodo view="member" projectId="p1" />);
    expect(await screen.findByTestId("project-todo-empty")).toHaveTextContent("本项目还没有待办");
  });

  it("观察者：只挂说明条，不发请求", async () => {
    const fetchMock = vi.fn(async () => json(BOARD));
    vi.stubGlobal("fetch", fetchMock);
    render(<TabTodo view="observer" projectId="p1" />);
    expect(screen.getByTestId("project-todo-observer-notice")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
    expect(screen.queryByTestId("project-todo-board")).toBeNull();
  });

  it("403 OBSERVER_CANNOT_VIEW_BOARD 如实显示人话，不显示错误码", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "forbidden", traceId: "t", reasonCode: "OBSERVER_CANNOT_VIEW_BOARD" }, 403)));
    render(<TabTodo view="member" projectId="p1" />);
    const err = await screen.findByTestId("project-todo-error");
    expect(err).toHaveTextContent("观察者看不到逐张卡片");
    expect(err).not.toHaveTextContent("OBSERVER_CANNOT_VIEW_BOARD");
  });
});
