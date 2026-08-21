import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";

const {
  replace, listPersonalThreads, getThread, createPersonalThread, renameThread, deleteThread,
  listCapabilities, sessionState,
} = vi.hoisted(() => ({
  replace: vi.fn(),
  listPersonalThreads: vi.fn(),
  getThread: vi.fn(),
  createPersonalThread: vi.fn(),
  renameThread: vi.fn(),
  deleteThread: vi.fn(),
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
vi.mock("@/lib/live-chat", () => ({
  listPersonalThreads, getThread, createPersonalThread, renameThread, deleteThread,
}));
vi.mock("@/lib/live-capabilities", () => ({ listCapabilities }));
/* 个人屏接入挂载面板后，面板会真的去读挂载列表——这里给它一个空列表，
   让"入口存在"这件事可断言，而不必把整个面板 stub 掉（stub 掉就测不到真东西了）。 */
const listThreadMounts = vi.fn().mockResolvedValue({ temporary: [], version: "0" });
vi.mock("@/lib/live-skill-mount", () => ({
  listThreadMounts: (...a: unknown[]) => listThreadMounts(...a),
  mountSkills: vi.fn(),
  unmountSkill: vi.fn(),
}));
const listSkills = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/live-skill", () => ({ listSkills: (...a: unknown[]) => listSkills(...a) }));
vi.mock("@/components/chat/chat-live-message-panel", () => ({
  ChatLiveMessagePanel: ({ agents }: { agents: unknown }) => (
    <div data-testid="stub-message-panel" data-agents={JSON.stringify(agents)} />
  ),
  /* ⚠ `chat-skill-mount-panel.tsx` 从本模块 re-export 处取 `describeMessageFailure`
     （它自己 re-export 自 `@/lib/live-chat`）。个人屏接入挂载面板后这条依赖被拉进来，
     mock 里缺了它会以 13 条 Unhandled Rejection 出现——**测试仍报 18 passed**，
     那正是 vitest 警告的「false positive」形状：断言没跑到就已经绿了。 */
  describeMessageFailure: (e: unknown) => String(e),
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

  it("一键即建：点「新建对话」直接建线程（null 标题，服务端自动命名），落进新会话", async () => {
    listPersonalThreads.mockResolvedValueOnce(EMPTY_LIST).mockResolvedValueOnce({
      groups: [{ label: "今天", cards: [{ id: "thr-new", title: "新对话", subtitle: "", badges: [], agentSummary: null, lastActivityAt: "2026-08-06T00:00:00.000Z", visibilityScope: "private" }] }],
      capabilities: ["thread.mutate"],
    });
    createPersonalThread.mockResolvedValue({ threadId: "thr-new", version: 0, auditEventId: "ev-1", impactScope: null });
    getThread.mockResolvedValue({
      thread: { id: "thr-new", projectId: null, groupId: null, visibilityScope: "private", phase: "onsite", archived: false, createdBy: "user-current", lastActivityAt: "2026-08-06T00:00:00.000Z", version: 0 },
      messages: [], rightTabs: [], capabilities: ["composer.send", "thread.mutate"],
    });

    render(<PersonalChatScreen initialThreadId={null} />);
    await screen.findByTestId("chat-thread-list-empty");

    // 2026-08-11 人类裁决：一键即建。点「＋ 新建对话」直接建一条 null 标题（服务端自动命名）
    // 的线程并落进去——没有中间标题表单、没有「确认」第二步（对齐 ChatGPT/Claude）。
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByTestId("chat-thread-create"));

    // 单击即以 null 标题建线程（服务端起默认名，前端不编一个）。
    await waitFor(() => expect(createPersonalThread).toHaveBeenCalledWith(null));
    await waitFor(() => expect(getThread).toHaveBeenCalledWith("thr-new", null, "provider-bearer"));
    expect(await screen.findByTestId("chat-thread-detail")).toBeInTheDocument();
    expect(await screen.findByTestId("stub-message-panel")).toBeInTheDocument();
  });

  it("一键即建没有中间表单——旧的「填标题 → 确认」两步已删（防回归）", async () => {
    listPersonalThreads.mockResolvedValueOnce(EMPTY_LIST).mockResolvedValueOnce({
      groups: [{ label: "今天", cards: [{ id: "thr-blank", title: "新对话", subtitle: "", badges: [], agentSummary: null, lastActivityAt: "2026-08-06T00:00:00.000Z", visibilityScope: "private" }] }],
      capabilities: ["thread.mutate"],
    });
    createPersonalThread.mockResolvedValue({ threadId: "thr-blank", version: 0, auditEventId: "ev-2", impactScope: null });
    getThread.mockResolvedValue({
      thread: { id: "thr-blank", projectId: null, groupId: null, visibilityScope: "private", phase: "onsite", archived: false, createdBy: "user-current", lastActivityAt: "2026-08-06T00:00:00.000Z", version: 0 },
      messages: [], rightTabs: [], capabilities: ["composer.send", "thread.mutate"],
    });

    render(<PersonalChatScreen initialThreadId={null} />);
    await screen.findByTestId("chat-thread-list-empty");

    // 点之前就不该有标题输入框/确认按钮/表单——两步式已删，不许悄悄回来。
    expect(screen.queryByTestId("chat-thread-title-input")).toBeNull();
    expect(screen.queryByTestId("chat-thread-title-submit")).toBeNull();
    expect(screen.queryByTestId("chat-thread-create-form")).toBeNull();

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByTestId("chat-thread-create"));

    // 单击直达 create(null)，中途也不冒出任何标题表单。
    await waitFor(() => expect(createPersonalThread).toHaveBeenCalledWith(null));
    expect(screen.queryByTestId("chat-thread-title-input")).toBeNull();
    expect(await screen.findByTestId("chat-thread-detail")).toBeInTheDocument();
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
 * 🔴 人类实测报告的真实 bug（2026-08-14）："看不到你说的改名和删除的功能"——组件此前的
 * 头注写着"改名、删除...本轮不做"，但后端（`mutateExisting`）与真库反证
 * （`personal-thread-no-project.test.ts`）早就就绪，只是前端一直没做入口。本节反证补上
 * 的 UI：选中线程才出现改名/删除入口、`projectId` 显式传 `null`（不是漏传导致
 * `undefined`）、成功后重读列表、删除后选中态正确回退。
 */
describe("PersonalChatScreen — 改名/删除（2026-08-14 补：此前只有后端，前端一直没做入口）", () => {
  beforeEach(() => {
    listPersonalThreads.mockReset();
    getThread.mockReset();
    renameThread.mockReset();
    deleteThread.mockReset();
    replace.mockReset();
  });

  const THREAD_LIST_TWO = {
    groups: [{ label: "今天", cards: [
      { id: "thr-a", title: "对话 A", subtitle: "", badges: [], agentSummary: null, lastActivityAt: "2026-08-06T00:00:00.000Z", visibilityScope: "private" },
      { id: "thr-b", title: "对话 B", subtitle: "", badges: [], agentSummary: null, lastActivityAt: "2026-08-06T00:00:00.000Z", visibilityScope: "private" },
    ] }],
    capabilities: ["thread.mutate"],
  };
  const detailFor = (id: string, version: number) => ({
    thread: { id, projectId: null, groupId: null, visibilityScope: "private", phase: "onsite", archived: false, createdBy: "user-current", lastActivityAt: "2026-08-06T00:00:00.000Z", version },
    messages: [], rightTabs: [], capabilities: ["composer.send", "thread.mutate"],
  });

  it("未选中任何线程 ⇒ 不渲染改名/删除入口（同 ChatReadScreen 的既有纪律）", async () => {
    listPersonalThreads.mockResolvedValue(THREAD_LIST_TWO);
    render(<PersonalChatScreen initialThreadId={null} />);
    await screen.findByTestId("chat-thread-thr-a");
    expect(screen.queryByTestId("chat-thread-selection-actions")).not.toBeInTheDocument();
  });

  it("选中一条线程 ⇒ 出现改名/删除入口；点改名 → 填标题 → 提交 → projectId 显式传 null，成功后重读列表", async () => {
    listPersonalThreads.mockResolvedValueOnce(THREAD_LIST_TWO).mockResolvedValueOnce(THREAD_LIST_TWO);
    getThread.mockResolvedValue(detailFor("thr-a", 3));
    renameThread.mockResolvedValue({ threadId: "thr-a", version: 4, auditEventId: "ev-r1", impactScope: null });

    render(<PersonalChatScreen initialThreadId="thr-a" />);
    await screen.findByTestId("chat-thread-detail");
    expect(await screen.findByTestId("chat-thread-selection-actions")).toBeInTheDocument();

    const { fireEvent } = await import("@testing-library/react");
    // 2026-08-14 重做：改名/删除现在挂在卡片自己的 hover「…」菜单里，
    // 要先点开菜单才能看到「改名」这个菜单项。
    fireEvent.click(screen.getByTestId("chat-thread-card-menu-trigger"));
    fireEvent.click(screen.getByTestId("chat-thread-rename"));
    const input = await screen.findByTestId("chat-thread-title-input");
    fireEvent.change(input, { target: { value: "改名了" } });
    fireEvent.click(screen.getByTestId("chat-thread-title-submit"));

    // ⚠ 决定性断言：projectId 显式传 null（第二个参数），不是漏传成 undefined——
    // #541 的教训是「忘传」，这里要证明的是「传了、且传的是 null」。
    await waitFor(() => expect(renameThread).toHaveBeenCalledWith("thr-a", null, "改名了", 3));
    await waitFor(() => expect(listPersonalThreads).toHaveBeenCalledTimes(2));
    // 表单提交后应该收起。
    expect(screen.queryByTestId("chat-thread-title-input")).not.toBeInTheDocument();
  });

  it("点删除 → 二次确认（必填原因）→ 提交 → 删完自动选中列表里剩下的那条", async () => {
    listPersonalThreads.mockResolvedValueOnce(THREAD_LIST_TWO).mockResolvedValueOnce({
      groups: [{ label: "今天", cards: [
        { id: "thr-b", title: "对话 B", subtitle: "", badges: [], agentSummary: null, lastActivityAt: "2026-08-06T00:00:00.000Z", visibilityScope: "private" },
      ] }],
      capabilities: ["thread.mutate"],
    });
    getThread.mockResolvedValue(detailFor("thr-a", 3));
    deleteThread.mockResolvedValue({ threadId: "thr-a", version: 4, auditEventId: "ev-d1", impactScope: null });

    render(<PersonalChatScreen initialThreadId="thr-a" />);
    await screen.findByTestId("chat-thread-detail");

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByTestId("chat-thread-card-menu-trigger"));
    fireEvent.click(screen.getByTestId("chat-thread-delete"));
    // 删除前必须先看到不可撤销 + 必填原因的二次确认，不是点一下就直接删。
    const reasonInput = await screen.findByTestId("chat-thread-delete-reason");
    const submit = screen.getByTestId("chat-thread-delete-submit");
    expect(submit).toBeDisabled(); // 原因未填时不可提交
    fireEvent.change(reasonInput, { target: { value: "测试用，清理" } });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() => expect(deleteThread).toHaveBeenCalledWith("thr-a", null, 3, "测试用，清理"));
    // 删完选中态回退到服务端返回列表里剩下的第一条，不是本地猜。
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/chat?thread=thr-b"));
  });

  it("删完一条不剩 ⇒ 选中态清空，回退到 /chat（空态，不是卡在一个已删线程的详情页）", async () => {
    listPersonalThreads.mockResolvedValueOnce({
      groups: [{ label: "今天", cards: [
        { id: "thr-only", title: "唯一一条", subtitle: "", badges: [], agentSummary: null, lastActivityAt: "2026-08-06T00:00:00.000Z", visibilityScope: "private" },
      ] }],
      capabilities: ["thread.mutate"],
    }).mockResolvedValueOnce(EMPTY_LIST);
    getThread.mockResolvedValue(detailFor("thr-only", 0));
    deleteThread.mockResolvedValue({ threadId: "thr-only", version: 1, auditEventId: "ev-d2", impactScope: null });

    render(<PersonalChatScreen initialThreadId="thr-only" />);
    await screen.findByTestId("chat-thread-detail");

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByTestId("chat-thread-card-menu-trigger"));
    fireEvent.click(screen.getByTestId("chat-thread-delete"));
    fireEvent.change(await screen.findByTestId("chat-thread-delete-reason"), { target: { value: "清空测试" } });
    fireEvent.click(screen.getByTestId("chat-thread-delete-submit"));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/chat"));
  });

  it("改名失败（服务端拒绝）⇒ 展示诚实错误，表单不静默消失、不假装成功", async () => {
    listPersonalThreads.mockResolvedValue(THREAD_LIST_TWO);
    getThread.mockResolvedValue(detailFor("thr-a", 3));
    renameThread.mockRejectedValue(new ApiError(409, "VERSION_CHANGED", {}));

    render(<PersonalChatScreen initialThreadId="thr-a" />);
    await screen.findByTestId("chat-thread-detail");

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByTestId("chat-thread-card-menu-trigger"));
    fireEvent.click(screen.getByTestId("chat-thread-rename"));
    fireEvent.change(await screen.findByTestId("chat-thread-title-input"), { target: { value: "改名了" } });
    fireEvent.click(screen.getByTestId("chat-thread-title-submit"));

    const failure = await screen.findByTestId("chat-thread-mutate-error");
    expect(failure).toHaveTextContent("HTTP 409");
    // 失败时列表**不该**重新拉取（乐观更新会先给用户一个假成功画面，这里必须没有）。
    expect(listPersonalThreads).toHaveBeenCalledTimes(1);
  });

  it("取消改名 ⇒ 表单收起，不发起任何请求", async () => {
    listPersonalThreads.mockResolvedValue(THREAD_LIST_TWO);
    getThread.mockResolvedValue(detailFor("thr-a", 3));

    render(<PersonalChatScreen initialThreadId="thr-a" />);
    await screen.findByTestId("chat-thread-detail");

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByTestId("chat-thread-card-menu-trigger"));
    fireEvent.click(screen.getByTestId("chat-thread-rename"));
    await screen.findByTestId("chat-thread-title-input");
    fireEvent.click(screen.getByText("取消"));

    expect(screen.queryByTestId("chat-thread-title-input")).not.toBeInTheDocument();
    expect(renameThread).not.toHaveBeenCalled();
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

/**
 * 人类裁决（2026-08-21，原话）：「个人对话必须要可以使用公共的 skills」「所有的人都可以用」。
 *
 * 服务端那一半在 #1693 已放开（个人线程可挂载，授权从线程反推项目）。但在此之前，
 * **个人对话屏连 `ChatSkillMountPanel` 的 import 都没有** —— 服务端改好了，用户在界面上
 * 依然挂不上，裁决没有真正生效。本组用例钉的就是"入口真的存在"这件事。
 *
 * ⚠ 断言落在**真实面板的 testid** 与**真实读接口被调用**上，不是断言一个 stub 存在——
 *   后者在面板被整个删掉时照样绿。
 */
describe("个人对话的 skill 挂载入口（人类 2026-08-21 裁决）", () => {
  it("选中一条个人线程 ⇒ 真实挂载面板被渲染，且用 undefined 的 projectId 去读挂载列表", async () => {
    listPersonalThreads.mockResolvedValue({
      groups: [{ label: "今天", cards: [{ id: "thr-sk", title: "新对话", subtitle: "", badges: [], agentSummary: null, lastActivityAt: "2026-08-06T00:00:00.000Z", visibilityScope: "private" }] }],
      capabilities: ["thread.mutate"],
    });
    getThread.mockResolvedValue({
      thread: { id: "thr-sk", projectId: null, groupId: null, visibilityScope: "private", phase: "onsite", archived: false, createdBy: "user-current", lastActivityAt: "2026-08-06T00:00:00.000Z", version: 0 },
      messages: [], rightTabs: [], capabilities: ["composer.send"],
    });

    render(<PersonalChatScreen initialThreadId="thr-sk" />);

    // ① 真实面板（不是 stub）出现在个人对话里。
    expect(await screen.findByTestId("chat-skill-mount-panel")).toBeInTheDocument();

    // ② ⭐ 反空转：它真的去读了挂载列表，且 projectId 传的是 undefined
    //    （个人线程没有项目；服务端 #1693 起也不再拿它当授权输入）。
    /* ⚠ 取**最近一次**调用，不是 `calls[0]`：这个 mock 在用例之间不重置，
       `calls[0]` 会是前面用例残留的那次（实测拿到 'thr-new'），断言就成了
       在测别人留下的状态。 */
    await waitFor(() =>
      expect(listThreadMounts.mock.calls.some((c) => c[0] === "thr-sk")).toBe(true),
    );
    const [threadIdArg, projectIdArg] =
      listThreadMounts.mock.calls.filter((c) => c[0] === "thr-sk").at(-1)!;
    expect(threadIdArg).toBe("thr-sk");
    expect(projectIdArg).toBeUndefined();
  });
});

/**
 * UIUX 修正（人类 2026-08-22 逐条指出）：挂载态此前显示 `sk_9c652f24-…` 这样的 UUID。
 * 用户敲 `#pp` 选的是「pptx」，挂上后名字却消失了——而名字明明就在候选池里。
 *
 * ⚠ 本用例钉的是「显示名称」。反证：把 `named` 换回 `entry.skillId` ⇒ 第 ② 条必红。
 */
describe("挂载态显示 skill 名称，不是 UUID（人类 2026-08-22）", () => {
  it("有挂载时 ⇒ 正文是名称，UUID 收进 title 仍可追溯", async () => {
    listPersonalThreads.mockResolvedValue({
      groups: [{ label: "今天", cards: [{ id: "thr-n", title: "新对话", subtitle: "", badges: [], agentSummary: null, lastActivityAt: "2026-08-06T00:00:00.000Z", visibilityScope: "private" }] }],
      capabilities: ["thread.mutate"],
    });
    getThread.mockResolvedValue({
      thread: { id: "thr-n", projectId: null, groupId: null, visibilityScope: "private", phase: "onsite", archived: false, createdBy: "user-current", lastActivityAt: "2026-08-06T00:00:00.000Z", version: 0 },
      messages: [], rightTabs: [], capabilities: ["composer.send"],
    });
    listThreadMounts.mockResolvedValue({
      temporary: [{ mountId: "m1", threadId: "thr-n", skillId: "sk_9c652f24", versionId: "sv1", mountedAt: "2026-08-22T00:00:00.000Z" }],
      version: "1",
    });
    listSkills.mockResolvedValue([{ skillId: "sk_9c652f24", name: "pptx", status: "已启用" }]);

    render(<PersonalChatScreen initialThreadId="thr-n" />);

    const chip = await screen.findByTestId("chat-skill-mounted-sk_9c652f24");
    await waitFor(() => expect(chip).toHaveTextContent("pptx"));
    // ⭐ 反空转：UUID 不再占正文（此前正是它占着）。
    expect(chip.textContent).not.toContain("sk_9c652f24");
    // id 仍可追溯 —— 收进 title，不是丢掉。
    expect(chip.getAttribute("title")).toContain("sk_9c652f24");
  });
});

