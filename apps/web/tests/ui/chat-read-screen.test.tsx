import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";

const { replace, listThreads, getThread, getAgentPanel, listMessages, createMessage, sessionState } = vi.hoisted(() => ({
  replace: vi.fn(),
  listThreads: vi.fn(),
  getThread: vi.fn(),
  getAgentPanel: vi.fn(),
  listMessages: vi.fn(),
  createMessage: vi.fn(),
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

  it("shows an honest missing-project state and performs no request", () => {
    render(<ChatReadScreen projectId={null} initialThreadId={null} />);

    expect(screen.getByTestId("chat-missing-project-context")).toHaveTextContent("请先选择项目");
    expect(listThreads).not.toHaveBeenCalled();
    expect(screen.queryByTestId("chat-composer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-new-thread")).not.toBeInTheDocument();
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
    expect(listMessages).toHaveBeenCalledTimes(2);
    expect(screen.getByText("只显示服务端持久消息；不会合成即时 AI 回复。")).toBeInTheDocument();
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
