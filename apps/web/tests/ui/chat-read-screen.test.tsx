import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { replace, listThreads, getThread, getAgentPanel, sessionState } = vi.hoisted(() => ({
  replace: vi.fn(),
  listThreads: vi.fn(),
  getThread: vi.fn(),
  getAgentPanel: vi.fn(),
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
vi.mock("@/lib/live-chat", () => ({ listThreads, getThread, getAgentPanel }));

import { ChatReadScreen } from "@/components/chat/chat-read-screen";

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
  });

  it("shows an honest missing-project state and performs no request", () => {
    render(<ChatReadScreen projectId={null} initialThreadId={null} />);

    expect(screen.getByTestId("chat-missing-project-context")).toHaveTextContent("请先选择项目");
    expect(listThreads).not.toHaveBeenCalled();
    expect(screen.queryByTestId("chat-composer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-new-thread")).not.toBeInTheDocument();
  });

  it("reads list, detail and roster with the provider bearer, then paginates returned messages", async () => {
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    expect(await screen.findByTestId("chat-thread-thread-real")).toHaveTextContent("真实线程");
    expect(await screen.findByTestId("chat-thread-detail")).toHaveTextContent("thread-real");
    expect(await screen.findByTestId("chat-roster-agent-agent-real")).toHaveTextContent("真实 Agent");

    expect(listThreads).toHaveBeenCalledWith("project-real", {}, "provider-bearer");
    expect(getThread).toHaveBeenCalledWith("thread-real", "project-real", "provider-bearer");
    expect(getAgentPanel).toHaveBeenCalledWith("thread-real", "project-real", "provider-bearer");

    const messages = screen.getByTestId("chat-message-list");
    expect(within(messages).getAllByTestId("chat-message-row")).toHaveLength(20);
    expect(within(messages).getByText("真实消息 1")).toBeInTheDocument();
    expect(within(messages).queryByText("真实消息 21")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("chat-messages-next"));
    expect(within(messages).getByText("真实消息 21")).toBeInTheDocument();
    expect(screen.getByTestId("chat-message-page-status")).toHaveTextContent("2 / 2");

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/发送|新建对话|AI 回复/)).not.toBeInTheDocument();
  });

  it("renders the server empty list without sample threads", async () => {
    listThreads.mockResolvedValueOnce({ groups: [] });
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
    expect(await screen.findByText("当前消息")).toBeInTheDocument();
    expect(await screen.findByText("当前 Agent")).toBeInTheDocument();
  });
});
