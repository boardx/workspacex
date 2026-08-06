import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";

const {
  replace, listPersonalThreads, getThread, createPersonalThread, sessionState,
} = vi.hoisted(() => ({
  replace: vi.fn(),
  listPersonalThreads: vi.fn(),
  getThread: vi.fn(),
  createPersonalThread: vi.fn(),
  sessionState: {
    sessionToken: "provider-bearer",
    currentOrgId: "org-current",
    userId: "user-current",
    orgIds: ["org-current"],
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ status: "authenticated", session: sessionState, identity: null, error: null }),
}));
vi.mock("@/components/shell/app-shell", () => ({
  AppShell: ({ left, children }: { left?: React.ReactNode; children: React.ReactNode }) => (
    <div><aside>{left}</aside><main>{children}</main></div>
  ),
}));
vi.mock("@/lib/live-chat", () => ({ listPersonalThreads, getThread, createPersonalThread }));
vi.mock("@/components/chat/chat-live-message-panel", () => ({
  ChatLiveMessagePanel: () => <div data-testid="stub-message-panel" />,
}));

import { PersonalChatScreen } from "@/components/chat/personal-chat-screen";

const EMPTY_LIST = { groups: [], capabilities: ["thread.mutate"] };

describe("PersonalChatScreen — 主路径", () => {
  /**
   * 🔴 活体浏览器验证时抓到的真实 bug：`detailLoadingKey === detailKey` 在两者
   * 都还是初始值 `null` 时为真，于是**没有任何请求在飞**的时候也显示"正在读取
   * 线程详情…"，永远盖住"从左侧新建或选择一条个人对话"这个空态。
   */
  it("零线程、未选中任何线程时 ⇒ 显示『从左侧新建或选择』空态，不是卡死的加载态", async () => {
    listPersonalThreads.mockResolvedValue(EMPTY_LIST);
    render(<PersonalChatScreen initialThreadId={null} />);
    await screen.findByTestId("chat-thread-list-empty");
    expect(await screen.findByTestId("chat-personal-no-selection")).toBeInTheDocument();
    expect(getThread).not.toHaveBeenCalled();
  });

  it("走 listPersonalThreads，不是 listThreads（个人模式用自己的端口，不冒充项目端口）", async () => {
    listPersonalThreads.mockResolvedValue(EMPTY_LIST);
    render(<PersonalChatScreen initialThreadId={null} />);
    await waitFor(() => expect(listPersonalThreads).toHaveBeenCalledWith({}, "provider-bearer"));
    expect(await screen.findByTestId("chat-thread-list-empty")).toBeInTheDocument();
  });

  it("建线程走 createPersonalThread，成功后重读列表并显示新会话", async () => {
    listPersonalThreads.mockResolvedValueOnce(EMPTY_LIST).mockResolvedValueOnce({
      groups: [{ label: "今天", cards: [{ id: "thr-new", title: "我的第一次对话", subtitle: "", badges: [], agentSummary: null, lastActivityAt: "2026-08-06T00:00:00.000Z", visibilityScope: "private" }] }],
      capabilities: ["thread.mutate"],
    });
    createPersonalThread.mockResolvedValue({ threadId: "thr-new", version: 0, auditEventId: "ev-1", impactScope: null });
    getThread.mockResolvedValue({
      thread: { id: "thr-new", projectId: null, groupId: null, visibilityScope: "private", phase: "onsite", archived: false, createdBy: "user-current", lastActivityAt: "2026-08-06T00:00:00.000Z", version: 0 },
      messages: [], rightTabs: [], capabilities: ["composer.send", "thread.mutate"],
    });

    render(<PersonalChatScreen initialThreadId={null} />);
    await screen.findByTestId("chat-thread-list-empty");

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(screen.getByTestId("chat-thread-title-input"), { target: { value: "我的第一次对话" } });
    fireEvent.click(screen.getByTestId("chat-thread-title-submit"));

    await waitFor(() => expect(createPersonalThread).toHaveBeenCalledWith("我的第一次对话"));
    await waitFor(() => expect(getThread).toHaveBeenCalledWith("thr-new", null, "provider-bearer"));
    expect(await screen.findByTestId("chat-thread-detail")).toBeInTheDocument();
    expect(await screen.findByTestId("stub-message-panel")).toBeInTheDocument();
  });
});

describe("🔴 PersonalChatScreen — 跨用户隔离（前端不得替后端的 404 兜底出内容）", () => {
  /**
   * 后端已用 15 条真实 HTTP+DB 测试证明 A 读不到 B 的个人线程（`getThread` 对
   * 非创建者返回 404，见 `apps/api/tests/chat/personal-thread-no-project.test.ts`
   * §3①）。前端这一层要证明的是**不同的东西**：拿到那个 404 之后，UI 是不是
   * 老老实实展示"读不到"，而不是回落到任何缓存/默认内容——那才是真正会把
   * 隔离前功尽弃的地方，因为后端已经做对了，前端在这里出错不会被任何后端测试发现。
   */
  it("getThread 返回 404（模拟另一用户的个人线程）⇒ 展示诚实的错误态，不展示任何会话内容", async () => {
    listPersonalThreads.mockResolvedValue({
      groups: [{ label: "今天", cards: [{ id: "thr-not-mine", title: "看起来像别人的线程 id", subtitle: "", badges: [], agentSummary: null, lastActivityAt: "2026-08-06T00:00:00.000Z", visibilityScope: "private" }] }],
      capabilities: ["thread.mutate"],
    });
    getThread.mockRejectedValue(new ApiError(404, "NOT_FOUND", {}));

    render(<PersonalChatScreen initialThreadId="thr-not-mine" />);

    const errorState = await screen.findByTestId("chat-thread-detail-error");
    expect(errorState).toHaveTextContent("HTTP 404");
    // 决定性的一条：即便列表卡片存在（因为它出现在**自己**的列表候选里，
    // 这本身就不该发生——但就算发生了），详情区**不得**渲染出任何消息面板或
    // 会话内容。空态/错误态与"读到了内容"必须是互斥的两个分支。
    expect(screen.queryByTestId("chat-thread-detail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stub-message-panel")).not.toBeInTheDocument();
  });

  it("换一个用户（sessionKey 变化）⇒ 上一个用户的列表结果不残留，重新发起请求", async () => {
    listPersonalThreads.mockResolvedValueOnce({
      groups: [{ label: "今天", cards: [{ id: "thr-user-a", title: "A 的对话", subtitle: "", badges: [], agentSummary: null, lastActivityAt: "2026-08-06T00:00:00.000Z", visibilityScope: "private" }] }],
      capabilities: ["thread.mutate"],
    });
    const { rerender } = render(<PersonalChatScreen initialThreadId={null} />);
    expect(await screen.findByTestId("chat-thread-thr-user-a")).toBeInTheDocument();

    // 模拟切到另一个用户的会话（sessionState 的 currentOrgId/bearer 在真实场景下
    // 会随 session 变化；这里直接换 mock 返回值 + 强制重渲染来逼近同一效果）。
    listPersonalThreads.mockResolvedValueOnce({
      groups: [{ label: "今天", cards: [{ id: "thr-user-b", title: "B 的对话", subtitle: "", badges: [], agentSummary: null, lastActivityAt: "2026-08-06T00:00:00.000Z", visibilityScope: "private" }] }],
      capabilities: ["thread.mutate"],
    });
    sessionState.userId = "user-b";
    sessionState.sessionToken = "provider-bearer-b";
    rerender(<PersonalChatScreen initialThreadId={null} />);

    await waitFor(() => expect(screen.queryByTestId("chat-thread-thr-user-a")).not.toBeInTheDocument());
    expect(await screen.findByTestId("chat-thread-thr-user-b")).toBeInTheDocument();
  });
});
