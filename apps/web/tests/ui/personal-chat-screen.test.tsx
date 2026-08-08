import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";

const {
  replace, listPersonalThreads, getThread, createPersonalThread, listCapabilities, sessionState,
} = vi.hoisted(() => ({
  replace: vi.fn(),
  listPersonalThreads: vi.fn(),
  getThread: vi.fn(),
  createPersonalThread: vi.fn(),
  listCapabilities: vi.fn(),
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
vi.mock("@/lib/live-capabilities", () => ({ listCapabilities }));
vi.mock("@/components/chat/chat-live-message-panel", () => ({
  ChatLiveMessagePanel: ({ agents }: { agents: unknown }) => (
    <div data-testid="stub-message-panel" data-agents={JSON.stringify(agents)} />
  ),
}));

import { PersonalChatScreen } from "@/components/chat/personal-chat-screen";

const EMPTY_LIST = { groups: [], capabilities: ["thread.mutate"] };

beforeEach(() => {
  listCapabilities.mockReset();
  listCapabilities.mockResolvedValue([]);
});

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

describe("PersonalChatScreen — agent 下拉（#594 后续：消灭手填 agent id 这个即时阻塞）", () => {
  const THREAD_LIST_WITH_ONE = {
    groups: [{ label: "今天", cards: [{ id: "thr-1", title: "对话", subtitle: "", badges: [], agentSummary: null, lastActivityAt: "2026-08-06T00:00:00.000Z", visibilityScope: "private" }] }],
    capabilities: ["thread.mutate"],
  };
  const THREAD_DETAIL = {
    thread: { id: "thr-1", projectId: null, groupId: null, visibilityScope: "private", phase: "onsite", archived: false, createdBy: "user-current", lastActivityAt: "2026-08-06T00:00:00.000Z", version: 0 },
    messages: [], rightTabs: [], capabilities: ["composer.send", "thread.mutate"],
  };

  /**
   * 决定性的一条：不再要求用户手填 id。列表里真实存在的 agent 通过
   * `listCapabilities(orgId, "agent")`（#458 已验证可用的读端口）读出来，
   * 原样透传给 `ChatLiveMessagePanel` 的下拉，而不是拼一个假的单元素数组。
   */
  it("组织里有已发布 agent ⇒ 用 listCapabilities(orgId,'agent') 读出真实列表并透传给下拉，不再要求手填 id", async () => {
    listPersonalThreads.mockResolvedValue(THREAD_LIST_WITH_ONE);
    getThread.mockResolvedValue(THREAD_DETAIL);
    listCapabilities.mockResolvedValue([
      { id: "agent-1", orgId: "org-current", kind: "agent", name: "客服助手", scope: "org", enabled: true, endpoint: null, disabledReason: null },
      { id: "agent-2", orgId: "org-current", kind: "agent", name: "停用的", scope: "org", enabled: false, endpoint: null, disabledReason: "停用测试" },
    ]);

    render(<PersonalChatScreen initialThreadId="thr-1" />);

    await waitFor(() => expect(listCapabilities).toHaveBeenCalledWith("org-current", "agent"));
    const panel = await screen.findByTestId("stub-message-panel");
    await waitFor(() => {
      const agents = JSON.parse(panel.getAttribute("data-agents") ?? "null");
      expect(agents).toEqual([{ id: "agent-1", abbr: "客服", name: "客服助手", duty: "组织已配置 Agent", presence: "present" }]);
    });

    // 手填 agent id 的文本框必须彻底消失。
    expect(screen.queryByTestId("personal-chat-agent-id")).not.toBeInTheDocument();
  });

  /**
   * 硬性要求第 3 条：组织里一个 agent 都没有时不能死锁——必须显示清楚的提示，
   * 而不是一个空白/无提示的"没有可选 Agent"就此卡死。
   */
  it("组织里一个 agent 都没有 ⇒ 显示明确提示引导去后台创建，不是空白卡死", async () => {
    listPersonalThreads.mockResolvedValue(THREAD_LIST_WITH_ONE);
    getThread.mockResolvedValue(THREAD_DETAIL);
    listCapabilities.mockResolvedValue([]);

    render(<PersonalChatScreen initialThreadId="thr-1" />);

    const hint = await screen.findByTestId("personal-chat-no-agents-hint");
    expect(hint).toHaveTextContent("后台创建一个 Agent");
    const link = hint.querySelector("a");
    expect(link).toHaveAttribute("href", "/admin/agent");
  });

  it("listCapabilities 失败 ⇒ 展示诚实的错误态 + 重试按钮，不是假装没有 agent", async () => {
    listPersonalThreads.mockResolvedValue(THREAD_LIST_WITH_ONE);
    getThread.mockResolvedValue(THREAD_DETAIL);
    listCapabilities.mockRejectedValue(new ApiError(500, "INTERNAL", {}));

    render(<PersonalChatScreen initialThreadId="thr-1" />);

    const errorState = await screen.findByTestId("personal-chat-agent-list-error");
    expect(errorState).toHaveTextContent("HTTP 500");
    expect(screen.queryByTestId("personal-chat-no-agents-hint")).not.toBeInTheDocument();
  });
});

/**
 * 🔴 人类实测报告的真实 bug（2026-08-07）："chat的手机端 没法选择session list"。
 * 根因：`AppShell` 的 `left` 栏 CSS 在 `<md` 断点整个 `hidden`，`/chat` 从没实现
 * 文档承诺的"改用底部一级 tab"替代导航——会话列表在手机上完全不可达。
 *
 * 这里 mock `window.matchMedia` 模拟 `<768px`，断言组件真的切到了 list/detail
 * 单栏模式：`AppShell` 收到的 `left` 变成 `undefined`（不再重复渲染同一份
 * `data-testid`），会话列表内容改渲进 `main`；选中线程后 `main` 换成详情 +
 * 一个可点的"返回列表"按钮，点了之后真的回到列表。
 */
function mockMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mql = {
    matches,
    media: "(min-width: 768px)",
    addEventListener: (_: "change", cb: (event: MediaQueryListEvent) => void) => { listeners.add(cb); },
    removeEventListener: (_: "change", cb: (event: MediaQueryListEvent) => void) => { listeners.delete(cb); },
  };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
  return mql;
}

describe("PersonalChatScreen — 手机端会话列表可达性（2026-08-07 真实 bug 报告）", () => {
  const THREAD_LIST_WITH_ONE = {
    groups: [{ label: "今天", cards: [{ id: "thr-mobile-1", title: "手机对话", subtitle: "", badges: [], agentSummary: null, lastActivityAt: "2026-08-06T00:00:00.000Z", visibilityScope: "private" }] }],
    capabilities: ["thread.mutate"],
  };
  const THREAD_DETAIL = {
    thread: { id: "thr-mobile-1", projectId: null, groupId: null, visibilityScope: "private", phase: "onsite", archived: false, createdBy: "user-current", lastActivityAt: "2026-08-06T00:00:00.000Z", version: 0 },
    messages: [], rightTabs: [], capabilities: ["composer.send", "thread.mutate"],
  };

  afterEach(() => vi.unstubAllGlobals());

  it("<768px 且未选中线程 ⇒ 会话列表渲进 main（不是消失在一个 CSS 隐藏的 aside 里）", async () => {
    mockMatchMedia(false);
    listPersonalThreads.mockResolvedValue(THREAD_LIST_WITH_ONE);

    render(<PersonalChatScreen initialThreadId={null} />);

    // 真正能点到的那一份在 main 里，不是 aside 里那份看不见的。
    const main = (await screen.findByTestId("chat-thread-thr-mobile-1")).closest("main");
    expect(main).not.toBeNull();
    // AppShell 没收到 left（mock 直接渲染 undefined，aside 应为空）——
    // 避免同一个 testid 在 DOM 里出现两份。
    expect(document.querySelector("aside")?.textContent ?? "").toBe("");
  });

  it("<768px 选中线程后 ⇒ 显示『返回列表』按钮，点击后回到列表且清空选中线程", async () => {
    mockMatchMedia(false);
    listPersonalThreads.mockResolvedValue(THREAD_LIST_WITH_ONE);
    getThread.mockResolvedValue(THREAD_DETAIL);

    render(<PersonalChatScreen initialThreadId="thr-mobile-1" />);

    const back = await screen.findByTestId("chat-thread-back-mobile");
    expect(back).toBeInTheDocument();

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(back);

    expect(replace).toHaveBeenCalledWith("/chat");
    // 回到列表：会话列表内容重新出现在 main 里。
    expect(await screen.findByTestId("chat-thread-thr-mobile-1")).toBeInTheDocument();
  });

  it("≥768px（桌面）行为完全不变：不出现『返回列表』按钮，left 正常拿到列表", async () => {
    mockMatchMedia(true);
    listPersonalThreads.mockResolvedValue(THREAD_LIST_WITH_ONE);
    getThread.mockResolvedValue(THREAD_DETAIL);

    render(<PersonalChatScreen initialThreadId="thr-mobile-1" />);

    await screen.findByTestId("chat-thread-detail");
    expect(screen.queryByTestId("chat-thread-back-mobile")).not.toBeInTheDocument();
    expect(document.querySelector("aside")?.textContent ?? "").not.toBe("");
  });
});
