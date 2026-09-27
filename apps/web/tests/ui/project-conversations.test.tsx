/**
 * 项目中枢 R4 —— 在项目里创建 chat、看到本项目的对话。
 * 钉住：子导航 `sub=conv` 真的切到对话列表 / 列表来自 `listThreads(projectId)` 且每张卡链到
 * `/chat/<id>?projectId=` / 「新建对话」调 `createProjectThread(projectId)` 后直接进入新线程 /
 * 观察者没有新建按钮 / 403 如实显示。只 mock 网络边界与路由。
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError, SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const listThreads = vi.fn();
const createProjectThread = vi.fn();
const getThread = vi.fn();
const setThreadVisibility = vi.fn();
const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects/p1",
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));
vi.mock("@/lib/live-chat", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-chat")>()),
  listThreads: (...a: unknown[]) => listThreads(...a),
  createProjectThread: (...a: unknown[]) => createProjectThread(...a),
  getThread: (...a: unknown[]) => getThread(...a),
  setThreadVisibility: (...a: unknown[]) => setThreadVisibility(...a),
}));

import { TabResearch } from "@/components/project/tab-research";

const CARD = (id: string, title: string) => ({
  id, title, subtitle: "", badges: [], status: { kind: "idle" }, artifactCount: 0,
  lastActivityAt: "2026-09-27T00:00:00Z", visibilityScope: "group-shared", pinned: false,
});
const THREADS = { groups: [
  { label: "今天", cards: [CARD("t1", "并网周期访谈整理")] },
  { label: "本周", cards: [CARD("t2", "问卷交叉切分")] },
  { label: "更早", cards: [] },
], capabilities: [] };

describe("R4 研究洞察 › 对话", () => {
  beforeEach(() => {
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok");
    listThreads.mockReset(); createProjectThread.mockReset(); getThread.mockReset(); setThreadVisibility.mockReset(); pushMock.mockReset();
    listThreads.mockResolvedValue(THREADS);
  });

  it("sub=conv 渲染本项目真实对话列表，每张卡链到 /chat/<id>?projectId=", async () => {
    render(<TabResearch view="facilitator" sub="conv" projectId="p1" />);
    const card = await screen.findByTestId("project-conversation-t1");
    expect(card).toHaveAttribute("href", "/chat/t1?projectId=p1");
    expect(card).toHaveTextContent("并网周期访谈整理");
    expect(screen.getByTestId("project-conversation-t2")).toHaveTextContent("问卷交叉切分");
    expect(listThreads).toHaveBeenCalledWith("p1");
    expect(screen.queryByTestId("project-research")).toBeNull();
  });

  it("没有 sub（研究总览）时仍是原来的汇总页，不拉线程", () => {
    render(<TabResearch view="facilitator" projectId="p1" />);
    expect(screen.getByTestId("project-research")).toBeInTheDocument();
    expect(listThreads).not.toHaveBeenCalled();
  });

  it("「在本项目中新建对话」：createProjectThread(projectId) 后直接进入新线程", async () => {
    createProjectThread.mockResolvedValue({ threadId: "t-new", version: 1 });
    render(<TabResearch view="member" sub="conv" projectId="p1" />);
    await screen.findByTestId("project-conversations-list");
    fireEvent.click(screen.getByTestId("project-conversations-new"));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/chat/t-new?projectId=p1"));
    expect(createProjectThread).toHaveBeenCalledWith("p1", null);
  });

  it("观察者：只读，没有新建按钮", async () => {
    render(<TabResearch view="observer" sub="conv" projectId="p1" />);
    await screen.findByTestId("project-conversations-list");
    expect(screen.queryByTestId("project-conversations-new")).toBeNull();
  });

  it("空列表如实空态；403 NO_PROJECT_ROLE 如实显示", async () => {
    listThreads.mockResolvedValue({ groups: [{ label: "今天", cards: [] }], capabilities: [] });
    const { unmount } = render(<TabResearch view="facilitator" sub="conv" projectId="p1" />);
    expect(await screen.findByTestId("project-conversations-empty")).toHaveTextContent("还没有你能看到的对话");
    unmount();
    listThreads.mockRejectedValue(new ApiError(403, "NO_PROJECT_ROLE", {}));
    render(<TabResearch view="facilitator" sub="conv" projectId="p1" />);
    expect(await screen.findByTestId("project-conversations-error")).toHaveTextContent("你不在这个项目里");
  });

  it("分享（R5）：改可见范围 = getThread 取 version → setThreadVisibility → 重拉列表", async () => {
    getThread.mockResolvedValue({ thread: { version: 5 } });
    setThreadVisibility.mockResolvedValue({ threadId: "t1", version: 6, auditEventId: "ev", impactScope: null });
    render(<TabResearch view="facilitator" sub="conv" projectId="p1" />);
    await screen.findByTestId("project-conversation-t1");
    expect(screen.getByTestId("project-conversation-share-t1")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("project-conversation-share-t1"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /^全场$/ }));
    await waitFor(() => expect(setThreadVisibility).toHaveBeenCalledWith("t1", "p1", "plenary", 5));
    expect(getThread).toHaveBeenCalledWith("t1", "p1");
    await waitFor(() => expect(listThreads).toHaveBeenCalledTimes(2));
  });

  it("分享被服务端拒（NO_WRITE_ROLE）：如实显示，不假装成功", async () => {
    getThread.mockResolvedValue({ thread: { version: 5 } });
    setThreadVisibility.mockRejectedValue(new ApiError(403, "NO_WRITE_ROLE", {}));
    render(<TabResearch view="member" sub="conv" projectId="p1" />);
    await screen.findByTestId("project-conversation-t1");
    fireEvent.keyDown(screen.getByTestId("project-conversation-share-t1"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /^全场$/ }));
    expect(await screen.findByTestId("project-conversations-share-error")).toHaveTextContent("创建者或本项目引导师");
  });

  it("观察者：可见范围只是徽标，没有分享控件", async () => {
    render(<TabResearch view="observer" sub="conv" projectId="p1" />);
    await screen.findByTestId("project-conversation-t1");
    expect(screen.queryByTestId("project-conversation-share-t1")).toBeNull();
  });
});
