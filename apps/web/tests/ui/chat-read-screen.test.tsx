import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";
import type { AgentRunStreamEvent } from "@/lib/agent-run-stream";

const {
  replace, listThreads, getThread, getAgentPanel, listMessages, createMessage, getAgentRun,
  listThreadArtifacts, listThreadAttachments, uploadAttachment, landAsArtifact,
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
  // issue #728 D9（人类 2026-08-21 裁决）——右栏「材料」列表，真实数据来自 chat_message_attachments。
  listThreadAttachments: vi.fn(),
  // issue #1758（人类给参考截图后裁决 C）——右栏「材料」头部「+」入口，走同一条真实上传端点。
  uploadAttachment: vi.fn(),
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
vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()), // 保留 ATTACHMENT_* 常量
  listThreads, getThread, getAgentPanel, listMessages, createMessage,
  listThreadArtifacts, listThreadAttachments, uploadAttachment, landAsArtifact,
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
function agentRunView(
  status: string,
  resultMessageId: string | null,
  error: string | null = null,
  steps: readonly Record<string, unknown>[] = [],
) {
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
    steps,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** #731 follow-up：一条 `tool_call` run step 的响应形状，字段照 `wave2-runtime.ts` 里
 * `AgentRunStep` 新增的 `toolName`/`toolArgsSummary`/`toolResultSummary`/`planningNote`。 */
function toolCallStep(overrides: Partial<{
  status: string; toolName: string | null; toolArgsSummary: string | null;
  toolResultSummary: string | null; planningNote: string | null; failureCode: string | null;
}> = {}) {
  return {
    kind: "tool_call",
    status: "succeeded",
    startedAt: "2026-01-01T00:00:01.000Z",
    endedAt: "2026-01-01T00:00:02.000Z",
    inputDigest: "a".repeat(64),
    outputDigest: "b".repeat(64),
    failureCode: null,
    toolName: "beautiful-article",
    toolArgsSummary: '{"task":"写一段介绍"}',
    toolResultSummary: "技能真实产出的文章内容",
    planningNote: "我需要一段介绍文字，调用 beautiful-article 来生成它。",
    ...overrides,
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
  /*
    #728 round 16 P10 —— 「落地为产物」按钮改为按 `getThread.out.capabilities`
    里的 `artifact.land` 渲染（写角色下发，个人线程/观察者不下发）。本夹具
    扮演的是**项目写角色**在读线程（下面两条落地用例点的就是这枚按钮），
    所以要带上真实 `capabilitiesFor(写角色)` 会下发的这一条——之前的空数组
    是该字段刚引入时的占位，那时还没有任何控件读它。
  */
  capabilities: ["artifact.land"],
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
    listThreadAttachments.mockResolvedValue({ items: [] });
    uploadAttachment.mockResolvedValue({
      id: "att-server-1", filename: "sidebar-upload.pdf", mime: "application/pdf",
      bytes: 1024, createdAt: "2026-08-22T00:00:00.000Z",
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
    // #1534：`SKILL_NOT_FOUND` 的裸 404 不该显示「对话不存在」——那句话把使用者导向
    // 错误的排查方向（真根因在 skill 那一侧，不是对话）。
    [404, "SKILL_NOT_FOUND", "该 skill 不存在或当前身份不可见（HTTP 404）"],
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
    // #728 D4：详情面副行不再把线程 id 印给用户看（评分卡要求人类可读面包屑）。
    // 绑定关系改由 `data-thread-id` 证明 —— 机器可读，且不占用户的界面。
    expect(await screen.findByTestId("chat-thread-detail")).toHaveAttribute("data-thread-id", "thread-real");
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
    // #728 —— 发送按钮改成图标化（Claude Code 风格紧凑输入区），文案不再是可见
    // 文本，挪到了 aria-label/title 上——断言跟着挪，不是削弱它：这条仍然验证
    // 「按钮此刻处于"可以发送"这句话所描述的状态」，只是读的属性变了。
    expect(screen.getByTestId("chat-message-submit")).toHaveAttribute("aria-label", "发送并排队");
  });

  /**
   * 十项 UX 缺口第 6 项（issue #712）—— 规则驱动的建议后续操作。
   * 默认 fixture 的第 20 条（最新一条）是 agent 消息（`index % 2 === 0`），
   * 所以规则「最新一条来自 agent ⇒ 建议两条追问模板」应该命中。
   */
  it("最新一条消息来自 agent 时显示两条规则驱动的追问建议，点击后填充输入框但不发送", async () => {
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    // ⚠ 等的是**那一条具体的建议**，不是容器。容器在消息还没读回来时就已经渲染了
    // （那时算出来的是零消息态的 `opener`），`findByTestId("chat-followup-suggestions")`
    // 会在第一帧就 resolve，随后同步 `getByTestId("...elaborate")` 必然扑空 ——
    // 这条断言此前依赖的是渲染时序的巧合，#728 改了中栏结构就暴露了。
    const elaborate = await screen.findByTestId("chat-followup-suggestion-elaborate");
    const suggestions = screen.getByTestId("chat-followup-suggestions");
    expect(elaborate).toHaveTextContent("能否再详细说明一下？");
    expect(within(suggestions).getByTestId("chat-followup-suggestion-summarize")).toHaveTextContent("请总结一下要点");

    fireEvent.click(elaborate);
    expect(screen.getByRole("textbox", { name: "消息内容" })).toHaveValue("能否再详细说明一下？");
    // 只是填充，不是自动发送——真实网络调用一次都不该发生。
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("线程零消息时建议一条通用开场白", async () => {
    listMessages.mockResolvedValueOnce({ messages: [], nextCursor: null });
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);
    const opener = await screen.findByTestId("chat-followup-suggestion-opener");
    expect(opener).toHaveTextContent("简要说明一下这次想解决的问题");
  });

  it("最新一条消息来自人类（发完在等 run）时不建议任何操作", async () => {
    listMessages.mockResolvedValueOnce({ messages: [durableMessage(1)], nextCursor: null });
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);
    await screen.findByText("真实消息 1");
    expect(screen.queryByTestId("chat-followup-suggestions")).not.toBeInTheDocument();
  });

  it("已归档的线程不显示建议（composer 本身已是只读）", async () => {
    getThread.mockResolvedValueOnce({
      ...threadDetail,
      thread: { ...threadDetail.thread, archived: true },
    });
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    await screen.findByTestId("chat-composer-archived");
    expect(screen.queryByTestId("chat-followup-suggestions")).not.toBeInTheDocument();
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

    // #728 D2：编制搬进左栏后，计数印在编制区**栏头**上（照原型：`本线程的 AI 团队 · N`，
    // N 是 rosterCount；在场数只在它与 rosterCount 不相等时附在后面）。
    // 本用例的立意没有变——两处数字必须来自同一次 getAgentPanel（上面的
    // `toHaveBeenCalledTimes(1)` 才是那条保证），这里只是跟着措辞改定位。
    const rosterPanel = screen.getByTestId("chat-read-roster");
    expect(rosterPanel).toHaveTextContent("本线程的 AI 团队 · 2");
    expect(rosterPanel).toHaveTextContent("在场 1");
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
   * issue #728 D9（人类 2026-08-21 裁决选项 A）—— 右栏「材料」列表真实渲染。
   * 数据来自真实 `listThreadAttachments`（与 `listThreadArtifacts` 同一批
   * `Promise.allSettled`），不是本地凑出来的；点击一条材料复用既有的
   * `ChatAttachmentPreviewModal`（#1584）。
   *
   * issue #1758：产物/材料从 tab 切换看改成堆叠同时可见，不再需要先点 tab 才能看到
   * 「材料」区块——本用例不再 `fireEvent.mouseDown` 任何 tab trigger，直接找面板。
   */
  it("右栏「材料」面板渲染真实 listThreadAttachments 结果，并带正确的 projectId/threadId", async () => {
    listThreadAttachments.mockResolvedValue({
      items: [
        {
          id: "att-real-1", filename: "真实材料.pdf", mime: "application/pdf",
          bytes: 2048, createdAt: "2026-08-21T00:00:00.000Z", messageId: "durable-message-2",
        },
      ],
    });
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    const panel = await screen.findByTestId("chat-materials-panel");
    expect(panel).toHaveTextContent("材料（1）");
    expect(panel).toHaveTextContent("真实材料.pdf");
    expect(listThreadAttachments).toHaveBeenCalledWith("thread-real", "project-real", "provider-bearer");
  });

  it("右栏「材料」为空时显示真实空态，不编造示例材料", async () => {
    listThreadAttachments.mockResolvedValue({ items: [] });
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    expect(await screen.findByTestId("chat-materials-empty")).toHaveTextContent("还没有随消息发出的材料");
  });

  /**
   * issue #1758（人类给参考截图后裁决）—— 右栏「产物」与「材料」从 tab 切换看改成
   * 上下堆叠、同时可见。两个面板 testid 应该**同时**能在 DOM 里找到，不需要任何
   * tab 切换动作。
   */
  it("右栏「产物」「材料」堆叠同时可见，不需要 tab 切换", async () => {
    listThreadArtifacts.mockResolvedValue({
      items: [{
        artifactId: "artifact-stack-1", title: "堆叠布局产物", mode: "draft",
        version: null, pinnedBy: null, pinnedAt: null, hasSource: false,
      }],
    });
    listThreadAttachments.mockResolvedValue({
      items: [{
        id: "att-stack-1", filename: "堆叠布局材料.pdf", mime: "application/pdf",
        bytes: 512, createdAt: "2026-08-22T00:00:00.000Z", messageId: "durable-message-2",
      }],
    });
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    const artifactsPanel = await screen.findByTestId("chat-artifacts-panel");
    const materialsPanel = await screen.findByTestId("chat-materials-panel");
    // 两者都在同一个 `chat-right-panel-stack` 容器内、同时挂载。
    const stack = screen.getByTestId("chat-right-panel-stack");
    expect(stack).toContainElement(artifactsPanel);
    expect(stack).toContainElement(materialsPanel);
    expect(artifactsPanel).toHaveTextContent("堆叠布局产物");
    expect(materialsPanel).toHaveTextContent("堆叠布局材料.pdf");
    // 不存在 Tabs 遗留的 trigger——已经从「切换看」改成「同时看」。
    expect(screen.queryByTestId("chat-right-tab-artifacts")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-right-tab-materials")).not.toBeInTheDocument();
  });

  /**
   * issue #1758（人类裁决 C）—— 右栏「材料」头部「+」上传入口：点了选文件后，走的是
   * composer 同一条真实 `uploadAttachment` 路径（同一个 `ChatAttachmentsController`），
   * 文件出现在输入框下方的 composer 附件区（`chat-attachment-list`），**不**自动发消息、
   * **不**立刻出现在材料列表里——材料列表仍然只在真正发消息之后才重读/出现新增项
   * （见下一条用例）。
   */
  it("右栏「材料」头部「+」上传的文件走真实上传端点、出现在 composer 附件区，但不自动发消息", async () => {
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    const materialsPanel = await screen.findByTestId("chat-materials-panel");
    const trigger = within(materialsPanel).getByTestId("chat-materials-upload-trigger");
    fireEvent.click(trigger);
    const input = within(materialsPanel).getByTestId("chat-materials-upload-input") as HTMLInputElement;
    const file = new File([new Uint8Array(8)], "sidebar-upload.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledWith(
      "thread-real", expect.any(File), "provider-bearer", expect.any(Function),
    ));

    // 出现在 composer 附件区（同一个 ChatAttachmentsController 实例）。
    const attachmentList = await screen.findByTestId("chat-attachment-list");
    await waitFor(() => expect(within(attachmentList).getByText("sidebar-upload.pdf")).toBeInTheDocument());

    // 没有自动发消息——不触发 createMessage，材料列表也没有因此重读出新内容。
    expect(createMessage).not.toHaveBeenCalled();
    expect(listThreadAttachments).toHaveBeenCalledTimes(1); // 只有初次进入线程那一次
  });

  /**
   * 发消息成功后（无论是否带附件）右栏「材料」都要重读——附件挂到消息上发生在
   * **发送这一刻**（`createMessage.attachmentIds`），不是等 agent run 落定才发生，
   * 所以这条不借用 `onRunSettled`，走单独的 `onMessageSent` 钩子（见
   * `chat-live-message-panel.tsx`）。本用例证明「发消息 → 不用手动刷新页面 →
   * 材料列表已经重读」。
   */
  it("发消息成功后立刻重读右栏「材料」列表，不需要手动刷新页面", async () => {
    const composer = await (async () => {
      render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);
      return screen.findByTestId("chat-composer");
    })();
    expect(listThreadAttachments).toHaveBeenCalledTimes(1); // 初次进入线程的那一次

    await waitFor(() => expect(screen.getByTestId("chat-agent-select")).toHaveTextContent("真实 Agent"));
    fireEvent.change(within(composer).getByRole("textbox", { name: "消息内容" }), {
      target: { value: "带附件的消息" },
    });
    await waitFor(() => expect(screen.getByTestId("chat-message-submit")).toBeEnabled());
    fireEvent.click(screen.getByTestId("chat-message-submit"));

    await waitFor(() => expect(createMessage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listThreadAttachments).toHaveBeenCalledTimes(2)); // 发送成功后自动重读
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
    // #728 D7——落地成功后渲染的是结构化卡片（标题 + AI 徽标 + 展开），不再是一行纯文本。
    const doneCard = await screen.findByTestId(`chat-land-artifact-done-${messageId}`);
    expect(doneCard).toHaveTextContent("手填的产物标题");
    expect(doneCard).toHaveTextContent("已落地为产物（草稿）");
    expect(doneCard).toHaveTextContent("AI");
    // 展开按钮真的能展开出这条消息的原文——本地已有数据，不是链一个不存在的产物详情页。
    fireEvent.click(within(doneCard).getByTestId(`chat-land-artifact-expand-${messageId}`));
    expect(screen.getByTestId(`chat-land-artifact-content-${messageId}`)).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByTestId("chat-agent-select")).toHaveTextContent("真实 Agent"));
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
    // #728 第 8 轮 P10 —— 裸 run id 不再印进人读文案，改断言 `data-run-id`。
    // 2026-08-19（#1589）：`chat-message-queued` 这个单独的"已排队"回执整个删掉了（人类
    // 实测反馈：与下面 `chat-live-agent-run-status` 的状态文案同屏重复说同一件事）——
    // 同一个 `data-run-id` 现在唯一挂在 `chat-live-agent-run-status` 上。
    expect(await screen.findByTestId("chat-live-agent-run-status")).toHaveAttribute("data-run-id", "run-new");
    // 三次 GET，一次都不是多余的（#435 之前是两次）：
    //   ① 进入线程时的首屏；② 202 之后立刻重读，让 human 消息马上出现；
    //   ③ run 到终态之后重读，让 #413 写回的那条**持久**回复出现。
    // ③ 是 #435 补的。少了它，助手回复要等用户手动刷新才看得见 —— run 明明成功了，
    // 界面却停在「已排队」，这正是步骤 8b 在界面上交付不了的那个缺口。
    await waitFor(() => expect(listMessages).toHaveBeenCalledTimes(3));
    // 而且新增的这次仍然是**从服务端读**，不是把回复合成到本地列表里。
    expect(createMessage).toHaveBeenCalledTimes(1);
    // 2026-08-14：常驻免责声明式提示已整个删除（人类实测反馈是多余噪音），
    // 这条测试原本顺带断言它存在，本行不再需要——上面对 `listMessages` 调用次数与
    // `createMessage` 未被二次调用的断言已经完整覆盖了这条测试真正要证的事
    // （回复来自服务端持久化重读，不是本地合成）。
  });

  /**
   * issue #728 D6/D7 取证根因回归：线程历史条数超过分页大小（`MESSAGE_PAGE_SIZE=50`）
   * 时，`nextCursor` 在**初次加载完成那一刻就已经非空**（`hasMore=true`）。这条测试
   * 用 20 条历史 + `limit` 无关的 `nextCursor: "cursor-20"` 模拟同样的「已经翻过一页」
   * 状态——不需要真凑够 50+1 条，只需要 `nextCursor` 非空这一个前置条件就足以复现。
   *
   * 根因（修前）：发送后 / run 终态后的「软重读」硬编码 `loadPage(null, "soft")`，
   * 也就是不管当前已经翻到哪一页，重读永远从游标起点（最旧那批）重新拉第一页——
   * 新发的人类消息与随后落库的 agent 回复因此**永远不在**这次重读拉回来的那一页里，
   * 但 `chat-live-agent-run-status` 仍然如实报告 run 到达终态（run 本身确实成功了，
   * 只是渲染用的这一页从来没盖到过它）。
   *
   * 断言两件事：① 软重读传的 cursor 是当前翻页位置（不是 `undefined`/起点）；
   * ② 新落库的 agent 回复真的出现在渲染出的消息列表里。
   */
  it("线程已翻过一页时，发送后 / run 终态后的软重读追着当前翻页位置走，新消息真的渲染出来（issue #728 D6/D7 根因回归）", async () => {
    listMessages
      .mockResolvedValueOnce({
        messages: Array.from({ length: 20 }, (_, index) => durableMessage(index + 1)),
        nextCursor: "cursor-20", // 已经 hasMore：真实场景对应「51 条历史、分页 50」
      })
      .mockResolvedValueOnce({
        // 发送后的第一次软重读：必须带上当前翻页位置的 cursor，才能追到刚发的这条
        messages: [durableMessage(21, "刚发的这条消息")],
        nextCursor: "cursor-21",
      })
      .mockResolvedValueOnce({
        // run 到终态后的第二次软重读：必须接着上一次的 cursor 往后走，才能追到 agent 回复
        messages: [durableMessage(22, "刚落库的 agent 回复")],
        nextCursor: null,
      });
    getAgentRun.mockResolvedValue(agentRunView("succeeded", "durable-message-22"));
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    await screen.findByTestId("chat-composer");
    await waitFor(() => expect(screen.getByTestId("chat-agent-select")).toHaveTextContent("真实 Agent"));
    fireEvent.change(screen.getByRole("textbox", { name: "消息内容" }), { target: { value: "跑一次" } });
    await waitFor(() => expect(screen.getByTestId("chat-message-submit")).toBeEnabled());
    fireEvent.click(screen.getByTestId("chat-message-submit"));

    // 发送后立刻可见：不是拉回第一页丢掉这条
    expect(await screen.findByText("刚发的这条消息")).toBeInTheDocument();
    expect(listMessages).toHaveBeenNthCalledWith(
      2, "thread-real", { cursor: "cursor-20", limit: 50 }, "provider-bearer",
    );

    // run 到终态后：agent 回复也真的渲染出来，不是停在「执行完成」但列表没变
    expect(await screen.findByText("刚落库的 agent 回复")).toBeInTheDocument();
    expect(listMessages).toHaveBeenNthCalledWith(
      3, "thread-real", { cursor: "cursor-21", limit: 50 }, "provider-bearer",
    );
    // 之前已经渲染过的历史消息没有因为这次软重读而消失（合并去重，不是整批替换）
    expect(screen.getByText("真实消息 1")).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByTestId("chat-agent-select")).toHaveTextContent("真实 Agent"));
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
    await waitFor(() => expect(screen.getByTestId("chat-agent-select")).toHaveTextContent("真实 Agent"));
    fireEvent.change(screen.getByRole("textbox", { name: "消息内容" }), { target: { value: "会失败的一次" } });
    await waitFor(() => expect(screen.getByTestId("chat-message-submit")).toBeEnabled());
    fireEvent.click(screen.getByTestId("chat-message-submit"));

    const status = await screen.findByTestId("chat-live-agent-run-status");
    await waitFor(() => expect(status).toHaveAttribute("data-run-status", "failed"));
    expect(status).toHaveTextContent("MODEL_CALL_FAILED");
    expect(status).not.toHaveAttribute("data-result-message-id");
  });

  /**
   * #731 follow-up —— chat-ux-acceptance-criteria.md 第 2/3 项：`GET /agent-runs/:runId`
   * 已经在 `steps` 里带了真实发生的 `tool_call` 步骤（工具名/参数摘要/结果摘要/计划文本），
   * 界面必须把它们画出来，而不是只显示一条笼统的"正在执行"。
   */
  it("渲染真实的 tool_call 步骤：调用前的计划、工具名、成功状态与结果摘要", async () => {
    // 2026-08-14：思考链现在挂在每条持久消息自己身上，种子的 20 条消息里 10 条是 AI
    // 消息（各带自己的 `agentRunId`）——按 runId 分流，只有触发本轮 submit 的那个
    // run（`run-new`，成功后重读为 `durable-message-22`/`agentRunId:"run-22"`）真的带
    // 工具调用步骤，其余种子消息的 run 一律回空 steps（`AgentToolChain` 空 steps 不
    // 渲染），避免页面上出现不止一个 `agent-tool-chain` 元素、断言指向不明。
    getAgentRun.mockImplementation(async (runId: string) => {
      if (runId === "run-new" || runId === "run-22") {
        return agentRunView("succeeded", "durable-message-22", null, [toolCallStep()]);
      }
      return agentRunView("succeeded", null);
    });
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    await screen.findByTestId("chat-composer");
    await waitFor(() => expect(screen.getByTestId("chat-agent-select")).toHaveTextContent("真实 Agent"));
    // 2026-08-14 重做：工具调用链现在挂在**持久消息自己**身上（`MessageThinkingChain`
    // 按 `message.agentRunId` 拉取），不再是 composer 下方跟着"当前是否有 run 在跑"
    // 走的瞬时状态——run 到终态后 `listMessages` 的重读（第 8b 步）必须真的把新消息
    // （带着它的 `agentRunId`）带回来，测试才能测到"消息 → 它自己的思考链"这条真实链路。
    //
    // ⚠ 三次 GET 里，第②次（202 之后立刻重读，agent 回复还没写回）与第③次（run 到终态
    // 后重读，回复已写回）都要显式排队——只排一个 `mockResolvedValueOnce` 会被第②次先
    // 消耗掉，第③次落回 `beforeEach` 的默认值（20 条、不含 22），message 22 先出现又
    // 被"擦掉"，`getAgentRun("run-22")` 那次拉取因此从来没等到它对应的消息行留在 DOM 里。
    const twentyOnly = { messages: Array.from({ length: 20 }, (_, index) => durableMessage(index + 1)), nextCursor: "cursor-20" };
    const twentyPlusNew = {
      messages: [...Array.from({ length: 20 }, (_, index) => durableMessage(index + 1)), durableMessage(22, "介绍文章正文")],
      nextCursor: "cursor-20",
    };
    listMessages.mockResolvedValueOnce(twentyOnly).mockResolvedValueOnce(twentyPlusNew);
    fireEvent.change(screen.getByRole("textbox", { name: "消息内容" }), { target: { value: "帮我生成一段介绍" } });
    await waitFor(() => expect(screen.getByTestId("chat-message-submit")).toBeEnabled());
    fireEvent.click(screen.getByTestId("chat-message-submit"));

    // TOOLCHAIN-01（人类裁决方案 A）：工具调用链**默认收起**成一行摘要，逐条细节
    // 折进折叠——先点开 toggle 才有 step 行。这一步正是 P7「默认可见」被反转后的界面真相。
    //
    // 2026-08-14：`findByTestId` 而非 `getByTestId`——在途 run 到终态那一刻，界面上
    // 短暂经过"composer 下方的活体气泡链"过渡到"持久消息自己的链"（`MessageThinkingChain`
    // 异步拉取），中间有一帧两者都不在 DOM 里，同步查询会撞上那一帧；用 `find*`（带重试）
    // 等它真正稳定到最终态。
    // 2026-08-14 二次实测：嵌套 waitFor(find*) 在并发跑全量套件、机器负载高时会撞上
    // 两层各自的默认 1000ms 超时叠加限流——单独跑/跑整份文件都稳定通过，只在整套
    // 并发下偶发超时，是资源争抢而非行为回归。显式放宽到 5000ms 吸收这类抖动。
    const chain = await screen.findByTestId("agent-tool-chain", {}, { timeout: 5000 });
    await waitFor(() => expect(chain).toHaveAttribute("data-tool-count", "1"), { timeout: 5000 });
    expect(screen.queryByTestId("agent-tool-chain-step-0")).toBeNull(); // 收起态：细节不在 DOM
    fireEvent.click(await screen.findByTestId("agent-tool-chain-toggle"));

    const step = await screen.findByTestId("agent-tool-chain-step-0");
    expect(step).toHaveAttribute("data-tool-name", "beautiful-article");
    expect(step).toHaveAttribute("data-tool-status", "succeeded");
    // 第 2 项——调用前的可见计划，真实来自后端 `planningNote`。
    expect(screen.getByTestId("agent-tool-chain-plan-0"))
      .toHaveTextContent("我需要一段介绍文字，调用 beautiful-article 来生成它。");
    expect(step).toHaveTextContent("调用 beautiful-article");
    expect(step).toHaveTextContent("完成");
    expect(step).toHaveTextContent("技能真实产出的文章内容");
  });

  it("工具调用失败：如实显示失败状态与失败原因，不假装成功", async () => {
    // 同上一条测试的理由：按 runId 分流，避免种子消息各自的 run 也渲出 agent-tool-chain。
    getAgentRun.mockImplementation(async (runId: string) => {
      if (runId === "run-new" || runId === "run-22") {
        return agentRunView("succeeded", "durable-message-22", null, [
          toolCallStep({
            status: "failed", failureCode: "MODEL_CALL_FAILED", planningNote: null,
            toolResultSummary: "未知工具「not-a-real-tool」：本次运行挂载的技能里没有这一个。",
          }),
        ]);
      }
      return agentRunView("succeeded", null);
    });
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    await screen.findByTestId("chat-composer");
    await waitFor(() => expect(screen.getByTestId("chat-agent-select")).toHaveTextContent("真实 Agent"));
    // 同上一条测试的理由：工具调用链现在挂在持久消息自己身上，且三次 GET 里第②、③次
    // 都要显式排队（只排一次会被第②次先消耗、第③次落回默认值把新消息"擦掉"）。
    listMessages
      .mockResolvedValueOnce({ messages: Array.from({ length: 20 }, (_, index) => durableMessage(index + 1)), nextCursor: "cursor-20" })
      .mockResolvedValueOnce({
        messages: [...Array.from({ length: 20 }, (_, index) => durableMessage(index + 1)), durableMessage(22, "调用失败的那次回复")],
        nextCursor: "cursor-20",
      });
    fireEvent.change(screen.getByRole("textbox", { name: "消息内容" }), { target: { value: "会调用失败的一次" } });
    await waitFor(() => expect(screen.getByTestId("chat-message-submit")).toBeEnabled());
    fireEvent.click(screen.getByTestId("chat-message-submit"));

    // TOOLCHAIN-01 方案 A 的核心保证：失败在**收起态**就以红徽标显性，不必点开就看到出事了
    // ——这正是「默认收起」不违背 P7「出错要看得见」精神的原因。
    // 2026-08-14：`findByTestId`（带重试）而非同步 `getByTestId`——理由同上一条测试，
    // 在途→持久两条渲染路径交接的那一帧要等它稳定。
    // 2026-08-14 二次实测：同上一条测试，嵌套 waitFor(find*) 在整套并发跑、机器负载高时
    // 会撞上两层默认 1000ms 超时叠加——放宽到 5000ms 吸收资源争抢导致的抖动。
    const chain = await screen.findByTestId("agent-tool-chain", {}, { timeout: 5000 });
    await waitFor(() => expect(chain).toHaveAttribute("data-fail-count", "1"), { timeout: 5000 });
    expect(await screen.findByTestId("agent-tool-chain-fail-badge")).toHaveTextContent("1 个失败");
    expect(screen.queryByTestId("agent-tool-chain-step-0")).toBeNull(); // 收起：step 细节不在 DOM
    fireEvent.click(await screen.findByTestId("agent-tool-chain-toggle"));

    const step = await screen.findByTestId("agent-tool-chain-step-0");
    expect(step).toHaveAttribute("data-tool-status", "failed");
    expect(step).toHaveTextContent("失败");
    expect(step).toHaveTextContent("未知工具「not-a-real-tool」");
    // 没有 planningNote 时不渲染计划行，不编一句话凑数。
    expect(screen.queryByTestId("agent-tool-chain-plan-0")).toBeNull();
  });

  it("没有任何 tool_call 步骤时不渲染步骤区域——不是黑盒，是没发生", async () => {
    getAgentRun.mockResolvedValue(agentRunView("succeeded", "durable-message-22"));
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    await screen.findByTestId("chat-composer");
    await waitFor(() => expect(screen.getByTestId("chat-agent-select")).toHaveTextContent("真实 Agent"));
    fireEvent.change(screen.getByRole("textbox", { name: "消息内容" }), { target: { value: "不用工具的一次" } });
    await waitFor(() => expect(screen.getByTestId("chat-message-submit")).toBeEnabled());
    fireEvent.click(screen.getByTestId("chat-message-submit"));

    await screen.findByTestId("chat-live-agent-run-status");
    // run 完全没有 step：折叠块整体不渲染（组件 steps.length===0 → null）——不是黑盒，是没发生。
    expect(screen.queryByTestId("agent-tool-chain")).toBeNull();
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
    await waitFor(() => expect(screen.getByTestId("chat-agent-select")).toHaveTextContent("真实 Agent"));
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
    await waitFor(() => expect(screen.getByTestId("chat-agent-select")).toHaveTextContent("真实 Agent"));
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
    await waitFor(() => expect(screen.getByTestId("chat-agent-select")).toHaveTextContent("真实 Agent"));
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
    await waitFor(() => expect(screen.getByTestId("chat-agent-select")).toHaveTextContent("真实 Agent"));
    fireEvent.change(screen.getByRole("textbox", { name: "消息内容" }), { target: { value: "可重试消息" } });
    await waitFor(() => expect(screen.getByTestId("chat-message-submit")).toBeEnabled());
    fireEvent.click(screen.getByTestId("chat-message-submit"));

    expect(await screen.findByTestId("chat-message-submit-error")).toHaveTextContent("依赖服务暂不可用");
    fireEvent.click(screen.getByTestId("chat-message-submit-retry"));
    await waitFor(() => expect(createMessage).toHaveBeenCalledTimes(2));
    expect(createMessage.mock.calls[1]![1].clientMessageId).toBe(
      createMessage.mock.calls[0]![1].clientMessageId,
    );
    expect(await screen.findByTestId("chat-live-agent-run-status")).toHaveAttribute("data-run-id", "run-retry");
  });

  it("renders a conflict explicitly and never fabricates a successful message", async () => {
    createMessage.mockRejectedValueOnce(new ApiError(409, "IDEMPOTENCY_CONFLICT", {}));
    render(<ChatReadScreen projectId="project-real" initialThreadId="thread-real" />);

    await screen.findByTestId("chat-composer");
    await waitFor(() => expect(screen.getByTestId("chat-agent-select")).toHaveTextContent("真实 Agent"));
    fireEvent.change(screen.getByRole("textbox", { name: "消息内容" }), { target: { value: "冲突消息" } });
    await waitFor(() => expect(screen.getByTestId("chat-message-submit")).toBeEnabled());
    fireEvent.click(screen.getByTestId("chat-message-submit"));

    expect(await screen.findByTestId("chat-message-submit-error")).toHaveTextContent("HTTP 409");
    expect(screen.getByTestId("chat-message-submit-error")).toHaveTextContent("未创建重复消息");
    // 409 意味着服务端从未真的建出一个 run——不该有任何 run 状态条冒出来。
    expect(screen.queryByTestId("chat-live-agent-run-status")).not.toBeInTheDocument();
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
