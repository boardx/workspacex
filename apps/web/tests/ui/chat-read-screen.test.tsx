import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";
import type { AgentRunStreamEvent } from "@/lib/agent-run-stream";

const {
  replace, listThreads, getThread, getAgentPanel, listMessages, createMessage, getAgentRun,
  listThreadArtifacts, landAsArtifact,
  openAgentRunStream, sessionState,
} = vi.hoisted(() => ({
  replace: vi.fn(),
  listThreads: vi.fn(),
  getThread: vi.fn(),
  getAgentPanel: vi.fn(),
  listMessages: vi.fn(),
  createMessage: vi.fn(),
  getAgentRun: vi.fn(),
  // 十项 UX 缺口第 4/5 项（#708）——右栏产物列表 + 消息内联落地为产物。
  listThreadArtifacts: vi.fn(),
  landAsArtifact: vi.fn(),
  // #654 阶段2d：默认永不 resolve/reject——这条流是纯装饰性的进度增强（组件自己的
  // effect 早有 `.catch()` 兜底），本文件盯的是 `getAgentRun` 那条权威轮询，不是它。
  // 让它是个挂起的 promise 而不是 `vi.fn().mockResolvedValue(undefined)`：立刻
  // resolve 会在每个用例里都真的跑一遍「流打开又关闭」的状态更新，制造与本文件断言
  // 无关的 act() 警告噪音。
  openAgentRunStream: vi.fn(
    (_runId: string, _onEvent: (event: AgentRunStreamEvent) => void, _opts?: unknown) =>
      new Promise<void>(() => {}),
  ),
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
vi.mock("@/lib/live-chat", () => ({
  listThreads, getThread, getAgentPanel, listMessages, createMessage, listThreadArtifacts, landAsArtifact,
}));
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
/** #654 阶段2d：见上面 `openAgentRunStream` 的 hoisted 注释。 */
vi.mock("@/lib/agent-run-stream", () => ({ openAgentRunStream }));

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
    listThreadArtifacts.mockResolvedValue({ items: [] });
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

  /**
   * 十项 UX 缺口第 9 项 —— 顶部实时状态 chip。
   *
   * 单一事实源：这个 chip 与 `RosterPanel` 里"在场 N · 编制 M"读的是**同一个**
   * `getAgentPanel` 结果，不是第二次请求、不是本地重算的第二份计数——所以本用例
   * 只断言两处数字相等，而不是分别校验两套独立逻辑。
   */
  it("顶部 chip 与花名册面板显示同一份在场/编制计数——同一次 getAgentPanel 请求，不是第二份事实", async () => {
    getAgentPanel.mockResolvedValue({
      agents: [
        { id: "agent-real", abbr: "AR", name: "真实 Agent", duty: "只读研究", presence: "present" },
        { id: "agent-second", abbr: "AS", name: "第二个 Agent", duty: "写作", presence: "away" },
      ],
      presentCount: 1,
      rosterCount: 2,
      marketEntry: "/admin/agent",
    });
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    const chip = await screen.findByTestId("chat-thread-live-status");
    expect(chip).toHaveTextContent("1 个 agent 在场");
    expect(chip).toHaveTextContent("编制 2");
    expect(getAgentPanel).toHaveBeenCalledTimes(1); // chip 没有触发第二次读。

    const rosterPanel = screen.getByTestId("chat-read-roster");
    expect(rosterPanel).toHaveTextContent("在场 1");
    expect(rosterPanel).toHaveTextContent("编制 2");
  });

  /**
   * 十项 UX 缺口第 4 项（issue #708）—— 右栏「产物」列表真实渲染。
   * 数据来自真实 `listThreadArtifacts`（与 `getThread`/`getAgentPanel` 同一批
   * `Promise.allSettled`），不是本地凑出来的。
   */
  it("右栏「产物」面板渲染真实 listThreadArtifacts 结果，并带正确的 projectId/threadId", async () => {
    listThreadArtifacts.mockResolvedValue({
      items: [
        {
          artifactId: "artifact-real-1", title: "真实草稿产物", mode: "draft",
          version: null, pinnedBy: null, pinnedAt: null, hasSource: false,
        },
      ],
    });
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    const panel = await screen.findByTestId("chat-artifacts-panel");
    expect(panel).toHaveTextContent("产物（1）");
    expect(panel).toHaveTextContent("真实草稿产物");
    expect(panel).toHaveTextContent("草稿");
    expect(listThreadArtifacts).toHaveBeenCalledWith("thread-real", "project-real", "provider-bearer");
  });

  it("右栏「产物」为空时显示真实空态，不编造示例产物", async () => {
    listThreadArtifacts.mockResolvedValue({ items: [] });
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    expect(await screen.findByTestId("chat-artifacts-empty")).toHaveTextContent("还没有落地的产物");
  });

  /**
   * 十项 UX 缺口第 5 项（issue #708）—— 消息内联「落地为产物」端到端：
   * 打开表单 → 填标题 → 提交 → 真实调用 `landAsArtifact`（`mode: "draft"`，
   * `payloadRef` = 该消息的真实 `text`）→ 成功后触发右栏重读。
   */
  it("消息内联「落地为产物」调用真实 landAsArtifact 并在成功后重读右栏产物列表", async () => {
    listThreadArtifacts.mockResolvedValue({ items: [] });
    landAsArtifact.mockResolvedValue({
      artifactId: "artifact-new-1",
      versionId: null,
      contentHash: null,
      mode: "draft",
      hasSource: false,
      provenanceBacklink: { conversationId: "thread-real", messageId: "durable-message-2", citations: [] },
    });
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    const openButton = within(await screen.findByTestId("chat-message-list"))
      .getAllByTestId(/^chat-land-artifact-open-/)[0]!;
    fireEvent.click(openButton);

    const messageId = openButton.getAttribute("data-testid")!.replace("chat-land-artifact-open-", "");
    const titleInput = screen.getByTestId(`chat-land-artifact-title-${messageId}`);
    fireEvent.change(titleInput, { target: { value: "手填的产物标题" } });
    fireEvent.click(screen.getByTestId(`chat-land-artifact-submit-${messageId}`));

    await waitFor(() => expect(landAsArtifact).toHaveBeenCalledTimes(1));
    expect(landAsArtifact).toHaveBeenCalledWith(
      "thread-real",
      { messageId, mode: "draft", title: "手填的产物标题", payloadRef: expect.any(String) },
      "provider-bearer",
    );
    expect(await screen.findByTestId(`chat-land-artifact-done-${messageId}`))
      .toHaveTextContent("已落地为产物（草稿）：手填的产物标题");
    // 成功后重新读取右栏产物列表——单一事实源仍是服务端 `listThreadArtifacts`。
    await waitFor(() => expect(listThreadArtifacts).toHaveBeenCalledTimes(2));
  });

  it("落地为产物失败时如实报错，不假装成功", async () => {
    listThreadArtifacts.mockResolvedValue({ items: [] });
    landAsArtifact.mockRejectedValue(new ApiError(422, "MISSING_PROVENANCE_BACKLINK", {}));
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    const openButton = within(await screen.findByTestId("chat-message-list"))
      .getAllByTestId(/^chat-land-artifact-open-/)[0]!;
    fireEvent.click(openButton);
    const messageId = openButton.getAttribute("data-testid")!.replace("chat-land-artifact-open-", "");
    fireEvent.click(screen.getByTestId(`chat-land-artifact-submit-${messageId}`));

    expect(await screen.findByTestId(`chat-land-artifact-error-${messageId}`))
      .toHaveTextContent("没有可用的已发布版本（HTTP 422）");
  });

  it("编制读取失败时，chip 不渲染猜测出来的数字（不伪造一个 0 个在场）", async () => {
    getAgentPanel.mockRejectedValue(new Error("roster unavailable"));
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);
    await screen.findByTestId("chat-roster-error");
    expect(screen.queryByTestId("chat-thread-live-status")).not.toBeInTheDocument();
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

  /**
   * #654 阶段2d —— 逐 token 草稿气泡。三件事各一条断言：①增量真的逐字追加进同一个
   * CopilotKit `Markdown` 渲染路径（不是纯文本）；②到达终态那一刻草稿立刻清空
   * （持久消息列表接管，不会短暂重复显示）；③默认（本文件从不触发任何 delta 事件的
   * 其它所有用例）从不渲染这个气泡——退化行为就是今天的样子，一个字节不多。
   */
  it("流式增量实时追加进草稿气泡，终态一到立刻清空，交给持久消息列表接管", async () => {
    let capturedOnEvent: ((event: AgentRunStreamEvent) => void) | null = null;
    openAgentRunStream.mockImplementation(
      (_runId: string, onEvent: (event: AgentRunStreamEvent) => void) => {
        capturedOnEvent = onEvent;
        return new Promise<void>(() => {}); // 挂起——由测试手动喂事件，模拟真实连接不会自己关。
      },
    );
    getAgentRun.mockResolvedValue(agentRunView("running", null));
    listMessages
      .mockResolvedValueOnce({
        messages: Array.from({ length: 20 }, (_, index) => durableMessage(index + 1)),
        nextCursor: "cursor-20",
      })
      .mockResolvedValue({ messages: [durableMessage(22, "**已落库的最终回复**")], nextCursor: null });

    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);
    await screen.findByTestId("chat-composer");
    await waitFor(() => expect(screen.getByTestId("chat-agent-select")).toHaveValue("agent-real"));
    fireEvent.change(screen.getByRole("textbox", { name: "消息内容" }), { target: { value: "流式跑一次" } });
    await waitFor(() => expect(screen.getByTestId("chat-message-submit")).toBeEnabled());
    fireEvent.click(screen.getByTestId("chat-message-submit"));

    await waitFor(() => expect(openAgentRunStream).toHaveBeenCalledWith(
      "run-new", expect.any(Function), expect.objectContaining({ sessionToken: "provider-bearer" }),
    ));
    expect(capturedOnEvent).not.toBeNull();

    act(() => { capturedOnEvent!({ type: "delta", text: "**部分" }); });
    const draft = await screen.findByTestId("chat-message-row-streaming");
    expect(draft).toHaveAttribute("data-run-id", "run-new");
    expect(draft).toHaveTextContent("部分");

    // 第二个增量把 markdown 语法拼完整——同一条 CopilotKit Markdown 渲染路径，
    // 累积文本真的被当 markdown 解释（加粗），不是原样吐出字面 `**`。
    act(() => { capturedOnEvent!({ type: "delta", text: "回复内容**" }); });
    await waitFor(() => expect(screen.getByTestId("chat-message-row-streaming")).toHaveTextContent("部分回复内容"));
    expect(screen.getByTestId("chat-message-row-streaming").querySelector("strong")).not.toBeNull();

    getAgentRun.mockResolvedValue(agentRunView("succeeded", "durable-message-22"));
    act(() => {
      capturedOnEvent!({ type: "final", status: "succeeded", resultMessageId: "durable-message-22" });
    });

    // 草稿立刻消失——不会和随后 `loadPage` 读回的持久消息同框重复一瞬间。
    await waitFor(() => expect(screen.queryByTestId("chat-message-row-streaming")).not.toBeInTheDocument());
  });

  it("默认（没有任何 delta 事件）从不渲染流式草稿气泡——退化到阶段2d之前的样子", async () => {
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);
    await screen.findByTestId("chat-composer");
    await waitFor(() => expect(screen.getByTestId("chat-agent-select")).toHaveValue("agent-real"));
    fireEvent.change(screen.getByRole("textbox", { name: "消息内容" }), { target: { value: "普通一次" } });
    await waitFor(() => expect(screen.getByTestId("chat-message-submit")).toBeEnabled());
    fireEvent.click(screen.getByTestId("chat-message-submit"));

    await screen.findByTestId("chat-live-agent-run-status");
    expect(screen.queryByTestId("chat-message-row-streaming")).not.toBeInTheDocument();
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
