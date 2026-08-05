import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";

const {
  replace, listThreads, getThread, getAgentPanel, listMessages, createMessage, getAgentRun,
  sessionState,
} = vi.hoisted(() => ({
  replace: vi.fn(),
  listThreads: vi.fn(),
  getThread: vi.fn(),
  getAgentPanel: vi.fn(),
  listMessages: vi.fn(),
  createMessage: vi.fn(),
  getAgentRun: vi.fn(),
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
  useSession: () => ({
    status: "authenticated",
    session: sessionState,
    identity: null,
    error: null,
  }),
}));
vi.mock("@/components/shell/app-shell", () => ({
  AppShell: ({ left, right, children }: {
    left?: React.ReactNode;
    right?: React.ReactNode;
    children: React.ReactNode;
  }) => <div><aside>{left}</aside><main>{children}</main><aside>{right}</aside></div>,
}));
vi.mock("@/lib/live-chat", () => ({ listThreads, getThread, getAgentPanel, listMessages, createMessage }));
/**
 * #435：`getAgentRun` 被 mock，但 `isTerminalRunStatus` **走真实实现**。
 *
 * 那个函数持有「哪些状态算终态」这条事实（`lib/agent-run.ts` 的 `TERMINAL_STATUSES`，
 * 与契约状态机同源）。把它一起 mock 掉，本文件就会在一份自己编的终态定义上跑 ——
 * 真实定义哪天改了它照样绿。只 mock 网络边界，不 mock 被测逻辑。
 */
vi.mock("@/lib/agent-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-run")>()),
  getAgentRun,
}));

import { ChatReadScreen } from "@/components/chat/chat-read-screen";
import { describeMessageFailure } from "@/components/chat/chat-live-message-panel";

function message(index: number) {
  return {
    id: `message-${index}`,
    authorKind: index % 2 === 0 ? "agent" : "human",
    agentId: index % 2 === 0 ? "agent-real" : null,
    skill: null,
    thinkingSummary: null,
    badges: [],
    citations: [],
    toolCallSummary: null,
    card: `真实消息 ${index}`,
  };
}

/** #435：`GET /agent-runs/:runId` 的响应形状，字段照 `wave2-runtime.ts:182-198`。 */
function agentRunView(status: string, resultMessageId: string | null, error: string | null = null) {
  return {
    runId: "run-new",
    threadId: "thread-real",
    inputMessageId: "durable-message-21",
    agentId: "agent-real",
    agentVersionId: "agent-real-v1",
    skillVersionIds: [],
    modelProvider: "test-provider",
    modelId: "test-model",
    status,
    error,
    resultMessageId,
    steps: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function durableMessage(index: number, text = `真实消息 ${index}`) {
  return {
    id: `durable-message-${index}`,
    authorKind: index % 2 === 0 ? "agent" : "human",
    authorId: index % 2 === 0 ? "agent-real" : "user-real",
    agentId: index % 2 === 0 ? "agent-real" : null,
    text,
    clientMessageId: index % 2 === 0 ? null : `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    agentRunId: index % 2 === 0 ? `run-${index}` : null,
    replyToMessageId: null,
    createdAt: `2026-08-04T00:00:${String(index).padStart(2, "0")}.000Z`,
  };
}

function threadList(id: string, title: string) {
  return {
    groups: [{
      label: "今天",
      cards: [{
        id,
        title,
        subtitle: "",
        badges: [],
        agentSummary: "agent-real",
        lastActivityAt: "2026-08-04T00:00:00.000Z",
        visibilityScope: "plenary",
      }],
    }],
    // #489：`listThreads.out` 现在必带项目级 capabilities——它是写入口渲染的唯一依据。
    // 这里只给读能力：本文件测的是读路径，写入口的用例在 chat-thread-crud.test.tsx。
    capabilities: ["thread.read"],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const threadDetail = {
  thread: {
    id: "thread-real",
    projectId: "project-real",
    groupId: null,
    visibilityScope: "plenary",
    phase: "research",
    archived: false,
    createdBy: "user-real",
    lastActivityAt: "2026-08-04T00:00:00.000Z",
    version: 3,
  },
  messages: Array.from({ length: 21 }, (_, index) => message(index + 1)),
  rightTabs: [
    { tab: "transcript", count: 0, failed: false },
    { tab: "execution", count: 0, failed: false },
    { tab: "insight", count: 0, failed: false },
    { tab: "artifact", count: 0, failed: false },
    { tab: "material", count: 0, failed: false },
  ],
  capabilities: [],
};

function detailFor(threadId: string, body: string) {
  return {
    ...threadDetail,
    thread: { ...threadDetail.thread, id: threadId },
    messages: [{ ...message(1), id: `${threadId}-message`, card: body }],
  };
}

describe("formal Chat read path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionState.sessionToken = "provider-bearer";
    sessionState.currentOrgId = "org-current";
    listThreads.mockResolvedValue(threadList("thread-real", "真实线程"));
    getThread.mockResolvedValue(threadDetail);
    getAgentPanel.mockResolvedValue({
      agents: [{ id: "agent-real", abbr: "AR", name: "真实 Agent", duty: "只读研究", presence: "present" }],
      presentCount: 1,
      rosterCount: 1,
      marketEntry: "/admin/agent",
    });
    listMessages.mockResolvedValue({
      messages: Array.from({ length: 20 }, (_, index) => durableMessage(index + 1)),
      nextCursor: "cursor-20",
    });
    createMessage.mockResolvedValue({
      message: durableMessage(22, "新持久消息"),
      agentRunId: "run-new",
      runStatus: "queued",
    });
    getAgentRun.mockResolvedValue(agentRunView("succeeded", "durable-message-22"));
  });

  it.each([
    [401, "SESSION_EXPIRED", "登录已失效（HTTP 401）"],
    [403, "NO_WRITE_ROLE", "没有写入权限（HTTP 403）"],
    [404, "NOT_FOUND", "不存在或当前身份不可见（HTTP 404）"],
    [409, "THREAD_ARCHIVED_READONLY", "状态冲突或已归档（HTTP 409）"],
    [422, "AGENT_NOT_FOUND", "没有可用的已发布版本（HTTP 422）"],
    [503, "AUTHZ_UNAVAILABLE", "没有降级到 mock"],
  ])("keeps HTTP %i failure semantics explicit", (status, reasonCode, expected) => {
    expect(describeMessageFailure(new ApiError(status, reasonCode, {}), "发送消息")).toContain(expected);
  });

  /**
   * #594 —— **改，不删**。这一条守的是「不伪造项目上下文」，那件事**没有**因为
   * #594 而不再重要：产品预期从「无项目就拦住」变成「无项目也能用」，
   * 但「无项目时随便挑一个项目装作用户选了它」依旧是事故。两者之差就是 #594 的难点。
   *
   * ⚠ `expect(listThreads).not.toHaveBeenCalled()` 单独看是**可能空转的**：
   *   若哪天 `listThreads` 的 mock 接错了名字，它在任何情况下都不会被调用，这条恒绿。
   *   所以下面立刻配一个**正样本**：同一个 mock、同一次渲染路径，带上真实 projectId
   *   之后它必须被调用、且带的正是那个 id。负样本 + 正样本一起才是一条断言。
   *
   * 「无项目时应当能开始对话」那一半是 #594 的缺口本体，**不在这里**——
   * 它在 `apps/web/e2e/chat-read.spec.ts` 的 `test.fail("[#594] …")` 上，
   * 契约冲突清单在 `apps/api/tests/chat/projectless-thread-create-gap.test.ts` 文件头。
   */
  it("#594: renders an honest missing-project state and invents no project context", async () => {
    const { unmount } = render(<ChatReadScreen projectId={null} initialThreadId={null} />);

    expect(screen.getByTestId("chat-missing-project-context")).toBeInTheDocument();
    expect(listThreads).not.toHaveBeenCalled();
    expect(screen.queryByTestId("chat-composer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-new-thread")).not.toBeInTheDocument();
    unmount();

    // 正样本配对：证明上面那个 `not.toHaveBeenCalled` 不是「这个 mock 永远不会被调用」。
    render(<ChatReadScreen projectId="project-real" initialThreadId={null} />);
    await waitFor(() => expect(listThreads).toHaveBeenCalledTimes(1));
    expect(listThreads.mock.calls[0]![0]).toBe("project-real");
  });

  it("reads list, detail, roster and the contract message page with the provider bearer", async () => {
    listMessages
      .mockResolvedValueOnce({
        messages: Array.from({ length: 20 }, (_, index) => durableMessage(index + 1)),
        nextCursor: "cursor-20",
      })
      .mockResolvedValueOnce({ messages: [durableMessage(21)], nextCursor: null });
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    expect(await screen.findByTestId("chat-thread-thread-real")).toHaveTextContent("真实线程");
    expect(await screen.findByTestId("chat-thread-detail")).toHaveTextContent("thread-real");
    expect(await screen.findByTestId("chat-roster-agent-agent-real")).toHaveTextContent("真实 Agent");

    expect(listThreads).toHaveBeenCalledWith("project-real", {}, "provider-bearer");
    expect(getThread).toHaveBeenCalledWith("thread-real", "project-real", "provider-bearer");
    expect(getAgentPanel).toHaveBeenCalledWith("thread-real", "project-real", "provider-bearer");
    expect(listMessages).toHaveBeenCalledWith("thread-real", { cursor: undefined, limit: 50 }, "provider-bearer");

    const messages = screen.getByTestId("chat-message-list");
    expect(within(messages).getAllByTestId("chat-message-row")).toHaveLength(20);
    expect(within(messages).getByText("真实消息 1")).toBeInTheDocument();
    expect(within(messages).queryByText("真实消息 21")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("chat-messages-load-more"));
    expect(await within(messages).findByText("真实消息 21")).toBeInTheDocument();
    expect(listMessages).toHaveBeenLastCalledWith("thread-real", { cursor: "cursor-20", limit: 50 }, "provider-bearer");

    expect(screen.getByRole("textbox", { name: "消息内容" })).toBeInTheDocument();
    expect(screen.getByTestId("chat-message-submit")).toHaveTextContent("发送并排队");
  });

  it("renders the server empty list without sample threads", async () => {
    listThreads.mockResolvedValueOnce({ groups: [], capabilities: ["thread.read"] });
    render(<ChatReadScreen projectId="empty-project" initialThreadId={null} />);

    expect(await screen.findByTestId("chat-thread-list-empty")).toHaveTextContent("还没有可见对话");
    expect(getThread).not.toHaveBeenCalled();
    expect(getAgentPanel).not.toHaveBeenCalled();
  });

  it("keeps list, detail and roster failures visible and retryable", async () => {
    listThreads.mockRejectedValueOnce(new Error("list unavailable"));
    render(<ChatReadScreen projectId="project-real" initialThreadId={null} />);

    expect(await screen.findByTestId("chat-thread-list-error")).toHaveTextContent("list unavailable");
    fireEvent.click(screen.getByTestId("chat-thread-list-retry"));
    await waitFor(() => expect(listThreads).toHaveBeenCalledTimes(2));
  });

  it("posts a client UUID to the selected Agent, then refreshes from GET without an inline reply", async () => {
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    const composer = await screen.findByTestId("chat-composer");
    await waitFor(() => expect(screen.getByTestId("chat-agent-select")).toHaveValue("agent-real"));
    fireEvent.change(within(composer).getByRole("textbox", { name: "消息内容" }), {
      target: { value: "请持久保存这条消息" },
    });
    await waitFor(() => expect(screen.getByTestId("chat-message-submit")).toBeEnabled());
    fireEvent.click(screen.getByTestId("chat-message-submit"));

    await waitFor(() => expect(createMessage).toHaveBeenCalledTimes(1));
    const [threadId, input, token] = createMessage.mock.calls[0]!;
    expect(threadId).toBe("thread-real");
    expect(token).toBe("provider-bearer");
    expect(input).toMatchObject({ text: "请持久保存这条消息", agentId: "agent-real" });
    expect(input.clientMessageId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await screen.findByTestId("chat-message-queued")).toHaveTextContent("run-new");
    // 三次 GET，一次都不是多余的（#435 之前是两次）：
    //   ① 进入线程时的首屏；② 202 之后立刻重读，让 human 消息马上出现；
    //   ③ run 到终态之后重读，让 #413 写回的那条**持久**回复出现。
    // ③ 是 #435 补的。少了它，助手回复要等用户手动刷新才看得见 —— run 明明成功了，
    // 界面却停在「已排队」，这正是步骤 8b 在界面上交付不了的那个缺口。
    await waitFor(() => expect(listMessages).toHaveBeenCalledTimes(3));
    // 而且新增的这次仍然是**从服务端读**，不是把回复合成到本地列表里。
    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByText("只显示服务端持久消息；不会合成即时 AI 回复。")).toBeInTheDocument();
  });

  /**
   * #435 —— AgentRun 的可见状态。
   *
   * 这三条盯的是同一件事的三个面：状态**来自服务端**、轮询**在终态停下**、
   * 读不到时**不编一个状态出来**。少了它们，`chat-live-agent-run-status` 会退化成
   * 一个「只要发过消息就常亮」的装饰物 —— 那正是它要取代的 `chat-message-queued`。
   */
  it("推进到终态前持续轮询 AgentRun，状态取自服务端而不是本地推断", async () => {
    getAgentRun
      .mockResolvedValueOnce(agentRunView("queued", null))
      .mockResolvedValueOnce(agentRunView("running", null))
      .mockResolvedValue(agentRunView("succeeded", "durable-message-22"));
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    await screen.findByTestId("chat-composer");
    await waitFor(() => expect(screen.getByTestId("chat-agent-select")).toHaveValue("agent-real"));
    fireEvent.change(screen.getByRole("textbox", { name: "消息内容" }), { target: { value: "跑一次" } });
    await waitFor(() => expect(screen.getByTestId("chat-message-submit")).toBeEnabled());
    fireEvent.click(screen.getByTestId("chat-message-submit"));

    const status = await screen.findByTestId("chat-live-agent-run-status");
    expect(status).toHaveAttribute("data-run-id", "run-new");
    await waitFor(
      () => expect(status).toHaveAttribute("data-run-status", "succeeded"),
      { timeout: 10_000 },
    );
    // 写回提交之后才有的字段。它非空 = 回复真的落库了，不是界面自己宣布成功。
    expect(status).toHaveAttribute("data-result-message-id", "durable-message-22");
    // 终态之后**必须停**。多轮询一次不致命，但「永不停止」会在真实环境里
    // 变成一条打不完的请求 —— 而单测是唯一能便宜地钉住这件事的地方。
    const callsAtTerminal = getAgentRun.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(getAgentRun.mock.calls.length).toBe(callsAtTerminal);
  }, 15_000);

  it("run 失败时如实显示 failed 与错误码，不合成回复", async () => {
    getAgentRun.mockResolvedValue(agentRunView("failed", null, "MODEL_CALL_FAILED"));
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    await screen.findByTestId("chat-composer");
    await waitFor(() => expect(screen.getByTestId("chat-agent-select")).toHaveValue("agent-real"));
    fireEvent.change(screen.getByRole("textbox", { name: "消息内容" }), { target: { value: "会失败的一次" } });
    await waitFor(() => expect(screen.getByTestId("chat-message-submit")).toBeEnabled());
    fireEvent.click(screen.getByTestId("chat-message-submit"));

    const status = await screen.findByTestId("chat-live-agent-run-status");
    await waitFor(() => expect(status).toHaveAttribute("data-run-status", "failed"));
    expect(status).toHaveTextContent("MODEL_CALL_FAILED");
    expect(status).not.toHaveAttribute("data-result-message-id");
  });

  it("读不到 run 时报读取失败，而不是渲染一个猜出来的状态", async () => {
    getAgentRun.mockRejectedValue(new ApiError(404, "AGENT_RUN_NOT_VISIBLE", {}));
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    await screen.findByTestId("chat-composer");
    await waitFor(() => expect(screen.getByTestId("chat-agent-select")).toHaveValue("agent-real"));
    fireEvent.change(screen.getByRole("textbox", { name: "消息内容" }), { target: { value: "读不到的一次" } });
    await waitFor(() => expect(screen.getByTestId("chat-message-submit")).toBeEnabled());
    fireEvent.click(screen.getByTestId("chat-message-submit"));

    const status = await screen.findByTestId("chat-live-agent-run-status");
    await waitFor(() => expect(status).toHaveTextContent("读取 AgentRun 状态失败"));
    // 「读不到 run」与「run 失败了」是两件事。混起来就是在界面上撒谎。
    expect(status).not.toHaveAttribute("data-run-status");
  });

  it("keeps the same clientMessageId when a dependency failure is retried", async () => {
    createMessage
      .mockRejectedValueOnce(new ApiError(503, "AUTHZ_UNAVAILABLE", {}))
      .mockResolvedValueOnce({
        message: durableMessage(22, "重试成功"),
        agentRunId: "run-retry",
        runStatus: "queued",
      });
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    await screen.findByTestId("chat-composer");
    await waitFor(() => expect(screen.getByTestId("chat-agent-select")).toHaveValue("agent-real"));
    fireEvent.change(screen.getByRole("textbox", { name: "消息内容" }), { target: { value: "可重试消息" } });
    await waitFor(() => expect(screen.getByTestId("chat-message-submit")).toBeEnabled());
    fireEvent.click(screen.getByTestId("chat-message-submit"));

    expect(await screen.findByTestId("chat-message-submit-error")).toHaveTextContent("依赖服务暂不可用");
    fireEvent.click(screen.getByTestId("chat-message-submit-retry"));
    await waitFor(() => expect(createMessage).toHaveBeenCalledTimes(2));
    expect(createMessage.mock.calls[1]![1].clientMessageId).toBe(
      createMessage.mock.calls[0]![1].clientMessageId,
    );
    expect(await screen.findByTestId("chat-message-queued")).toHaveTextContent("run-retry");
  });

  it("renders a conflict explicitly and never fabricates a successful message", async () => {
    createMessage.mockRejectedValueOnce(new ApiError(409, "IDEMPOTENCY_CONFLICT", {}));
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    await screen.findByTestId("chat-composer");
    await waitFor(() => expect(screen.getByTestId("chat-agent-select")).toHaveValue("agent-real"));
    fireEvent.change(screen.getByRole("textbox", { name: "消息内容" }), { target: { value: "冲突消息" } });
    await waitFor(() => expect(screen.getByTestId("chat-message-submit")).toBeEnabled());
    fireEvent.click(screen.getByTestId("chat-message-submit"));

    expect(await screen.findByTestId("chat-message-submit-error")).toHaveTextContent("HTTP 409");
    expect(screen.getByTestId("chat-message-submit-error")).toHaveTextContent("未创建重复消息");
    expect(screen.queryByTestId("chat-message-queued")).not.toBeInTheDocument();
  });

  it("hides the previous context synchronously while the replacement request is pending", async () => {
    const next = deferred<ReturnType<typeof threadList>>();
    listThreads.mockResolvedValueOnce(threadList("thread-old", "旧项目线程"));
    const view = render(<ChatReadScreen projectId="project-old" initialThreadId={null} />);
    expect(await screen.findByText("旧项目线程")).toBeInTheDocument();

    listThreads.mockReturnValueOnce(next.promise);
    view.rerender(<ChatReadScreen projectId="project-new" initialThreadId={null} />);

    expect(screen.queryByText("旧项目线程")).not.toBeInTheDocument();
    expect(screen.getByText("正在加载真实线程…")).toBeInTheDocument();

    await act(async () => next.resolve(threadList("thread-new", "新项目线程")));
    expect(await within(screen.getByTestId("chat-read-thread-list")).findByText("新项目线程")).toBeInTheDocument();
  });

  it("rejects list results that arrive after project context changed", async () => {
    const oldRequest = deferred<ReturnType<typeof threadList>>();
    const newRequest = deferred<ReturnType<typeof threadList>>();
    listThreads.mockReset();
    listThreads.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);

    const view = render(<ChatReadScreen projectId="project-old" initialThreadId={null} />);
    await waitFor(() => expect(listThreads).toHaveBeenCalledTimes(1));
    view.rerender(<ChatReadScreen projectId="project-new" initialThreadId={null} />);
    await waitFor(() => expect(listThreads).toHaveBeenCalledTimes(2));

    await act(async () => oldRequest.resolve(threadList("thread-late", "迟到旧线程")));
    expect(screen.queryByText("迟到旧线程")).not.toBeInTheDocument();

    await act(async () => newRequest.resolve(threadList("thread-current", "当前线程")));
    expect(await within(screen.getByTestId("chat-read-thread-list")).findByText("当前线程")).toBeInTheDocument();
  });

  it("rejects late detail and roster results after the selected thread changed", async () => {
    const oldDetail = deferred<ReturnType<typeof detailFor>>();
    const newDetail = deferred<ReturnType<typeof detailFor>>();
    const oldRoster = deferred<{ agents: Array<{ id: string; abbr: string; name: string; duty: string; presence: string }>; presentCount: number; rosterCount: number; marketEntry: null }>();
    const newRoster = deferred<{ agents: Array<{ id: string; abbr: string; name: string; duty: string; presence: string }>; presentCount: number; rosterCount: number; marketEntry: null }>();
    getThread.mockReset();
    getThread.mockReturnValueOnce(oldDetail.promise).mockReturnValueOnce(newDetail.promise);
    getAgentPanel.mockReset();
    getAgentPanel.mockReturnValueOnce(oldRoster.promise).mockReturnValueOnce(newRoster.promise);

    const view = render(<ChatReadScreen projectId="project-real" initialThreadId="thread-old" />);
    await waitFor(() => expect(getThread).toHaveBeenCalledWith("thread-old", "project-real", "provider-bearer"));
    view.rerender(<ChatReadScreen projectId="project-real" initialThreadId="thread-new" />);
    await waitFor(() => expect(getThread).toHaveBeenCalledWith("thread-new", "project-real", "provider-bearer"));

    await act(async () => {
      oldDetail.resolve(detailFor("thread-old", "迟到旧消息"));
      oldRoster.resolve({
        agents: [{ id: "agent-old", abbr: "AO", name: "迟到旧 Agent", duty: "旧职责", presence: "present" }],
        presentCount: 1,
        rosterCount: 1,
        marketEntry: null,
      });
    });
    expect(screen.queryByText("迟到旧消息")).not.toBeInTheDocument();
    expect(screen.queryByText("迟到旧 Agent")).not.toBeInTheDocument();

    await act(async () => {
      newDetail.resolve(detailFor("thread-new", "当前消息"));
      newRoster.resolve({
        agents: [{ id: "agent-new", abbr: "AN", name: "当前 Agent", duty: "新职责", presence: "present" }],
        presentCount: 1,
        rosterCount: 1,
        marketEntry: null,
      });
    });
    expect(await screen.findByTestId("chat-thread-detail")).toHaveTextContent("thread-new");
    expect(await screen.findAllByText("当前 Agent")).toHaveLength(2);
  });
});
