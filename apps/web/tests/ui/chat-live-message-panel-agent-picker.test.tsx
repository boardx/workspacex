/**
 * issue #1803 —— 2026-08-22 devapp 真实浏览器实测抓到的 3 个消息面板 UX 缺口：
 *
 * gap #2：「运行 Agent」下拉（`AgentPicker`，`chat-composer-pickers.tsx`）点开后，
 *   点外部空白 / 按 Escape 都不关闭，只能再点一次触发按钮。
 * gap #3：`AgentPicker` 与「加 skill」快捷挂载列表（`ChatSkillMountPanel` 的
 *   `picking`）此前是两个互不相知的私有 state，可以同屏叠开。
 * gap #4：「正在思考…」卡片下的 longrun hint 固定文案「执行 skill 脚本时可能需要
 *   数分钟」，不看这条线程是否真的挂了 skill。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { listMessages, createMessage, getAgentRun, openAgentRunStream, openAsrDraftStream } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  createMessage: vi.fn(),
  getAgentRun: vi.fn(),
  openAgentRunStream: vi.fn(() => new Promise<void>(() => {})),
  openAsrDraftStream: vi.fn(() => new Promise<never>(() => {})),
}));

vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listMessages,
  createMessage,
  landAsArtifact: vi.fn(),
}));
vi.mock("@/lib/agent-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-run")>()),
  getAgentRun,
}));
vi.mock("@/lib/agent-run-stream", () => ({ openAgentRunStream }));
vi.mock("@/lib/live-asr-draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-asr-draft")>()),
  openAsrDraftStream,
}));

const listThreadMounts = vi.fn();
const mountSkills = vi.fn();
const unmountSkill = vi.fn();
vi.mock("@/lib/live-skill-mount", () => ({
  listThreadMounts: (...a: unknown[]) => listThreadMounts(...a),
  mountSkills: (...a: unknown[]) => mountSkills(...a),
  unmountSkill: (...a: unknown[]) => unmountSkill(...a),
}));
const listSkills = vi.fn();
vi.mock("@/lib/live-skill", () => ({ listSkills: (...a: unknown[]) => listSkills(...a) }));

import { ChatLiveMessagePanel } from "@/components/chat/chat-live-message-panel";
import { ChatSkillMountPanel } from "@/components/chat/chat-skill-mount-panel";
import { ChatPopoverCoordinatorProvider } from "@/components/chat/chat-popover-coordinator";

const agents = [
  { id: "agent-a", abbr: "AA", name: "Agent A", duty: "研究", roleLabel: "研究", presence: "present" as const },
  { id: "agent-b", abbr: "AB", name: "Agent B", duty: "写作", roleLabel: "写作", presence: "present" as const },
];

/** 与「消息面板 + skill 挂载栏」在真实页面（`chat-read-screen.tsx`）里的组合方式一致。 */
function renderComposedScreen() {
  return render(
    <ChatPopoverCoordinatorProvider>
      <ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />
      <ChatSkillMountPanel threadId="t" orgId="org-1" bearer="b" />
    </ChatPopoverCoordinatorProvider>,
  );
}

describe("AgentPicker（运行 Agent 下拉）—— gap #2：outside-click / Escape 关闭", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMessages.mockResolvedValue({ messages: [], nextCursor: null });
    getAgentRun.mockResolvedValue(null);
  });

  it("点击外部空白区域会关闭下拉", async () => {
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("chat-agent-select"));
    expect(await screen.findByTestId("chat-agent-select-listbox")).toBeInTheDocument();

    // 外部空白：document.body 本身。
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByTestId("chat-agent-select-listbox")).not.toBeInTheDocument());
  });

  it("按 Escape 会关闭下拉", async () => {
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("chat-agent-select"));
    expect(await screen.findByTestId("chat-agent-select-listbox")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("chat-agent-select-listbox")).not.toBeInTheDocument());
  });

  it("点击下拉内部（比如选一个 agent）不会被外部点击逻辑误关——选中后按自己的逻辑收起", async () => {
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("chat-agent-select"));
    await screen.findByTestId("chat-agent-select-listbox");

    fireEvent.click(screen.getByTestId("chat-agent-select-option-agent-b"));
    await waitFor(() => expect(screen.queryByTestId("chat-agent-select-listbox")).not.toBeInTheDocument());
    expect(screen.getByTestId("chat-agent-select")).toHaveTextContent("Agent B");
  });
});

describe("AgentPicker × ChatSkillMountPanel —— gap #3：两个浮层互斥，不可同屏叠开", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMessages.mockResolvedValue({ messages: [], nextCursor: null });
    getAgentRun.mockResolvedValue(null);
    listThreadMounts.mockResolvedValue({ temporary: [], version: "0" });
    listSkills.mockResolvedValue([{ skillId: "sk-1", name: "示例 skill", status: "已启用" }]);
  });

  it("先开「运行 Agent」下拉，再点「加 skill」⇒ Agent 下拉自动关闭，只剩一个浮层", async () => {
    renderComposedScreen();
    await waitFor(() => expect(listMessages).toHaveBeenCalled());
    await waitFor(() => expect(listThreadMounts).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("chat-agent-select"));
    expect(await screen.findByTestId("chat-agent-select-listbox")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("chat-skill-mount"));
    await screen.findByTestId("chat-skill-mount-picker");

    // 决定性断言：Agent 下拉必须已经关闭，不是两个同屏叠着。
    expect(screen.queryByTestId("chat-agent-select-listbox")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-skill-mount-picker")).toBeInTheDocument();
  });

  it("反过来也一样：先开挂载候选面板，再开 Agent 下拉 ⇒ 挂载面板自动关闭", async () => {
    renderComposedScreen();
    await waitFor(() => expect(listMessages).toHaveBeenCalled());
    await waitFor(() => expect(listThreadMounts).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("chat-skill-mount"));
    await screen.findByTestId("chat-skill-mount-picker");

    fireEvent.click(screen.getByTestId("chat-agent-select"));
    await screen.findByTestId("chat-agent-select-listbox");

    expect(screen.queryByTestId("chat-skill-mount-picker")).not.toBeInTheDocument();
  });

  it("没有 Provider 时两个浮层各自独立（不互斥）—— 单独渲染 ChatLiveMessagePanel 的既有单测不受影响", async () => {
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("chat-agent-select"));
    expect(await screen.findByTestId("chat-agent-select-listbox")).toBeInTheDocument();
  });
});

describe("ChatLiveMessagePanel — gap #4：longrun hint 措辞按是否真的挂了 skill 区分", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 初次加载空列表；发送后的「软重读」（`submit()` 里的 `loadPage(..., "soft")`）
    // 要读到刚发的那条人类消息——`awaitingReply`/thinking 卡片只在
    // `messages.length > 0` 时渲染（`chat-live-message-panel.tsx:942`），
    // 全程空列表会让这组用例断言不到任何东西，看起来像组件坏了，其实是 mock 没跟上。
    listMessages
      .mockResolvedValueOnce({ messages: [], nextCursor: null })
      .mockResolvedValue({
        messages: [{
          id: "m-1", authorKind: "human", authorId: "u", agentId: null, text: "你好",
          clientMessageId: null, agentRunId: "run-1", replyToMessageId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        }],
        nextCursor: null,
      });
    createMessage.mockResolvedValue({
      message: { id: "m-1", authorKind: "human", authorId: "u", agentId: null, text: "x", clientMessageId: null, agentRunId: null, replyToMessageId: null, createdAt: "2026-01-01T00:00:00.000Z" },
      agentRunId: "run-1",
      runStatus: "queued",
    });
    // 永不到终态 —— 让「正在思考…」卡片持续存在，方便向前快进耗时。
    getAgentRun.mockResolvedValue({
      runId: "run-1", threadId: "t", inputMessageId: "m-1", agentId: "agent-a", agentVersionId: "v1",
      skillVersionIds: [], modelProvider: "p", modelId: "m", status: "queued", error: null,
      resultMessageId: null, steps: [], createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function flushMicrotasks(times = 12) {
    for (let i = 0; i < times; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  /**
   * ⚠ fake timers 下故意不用 `findByTestId`/`waitFor`——它们内部的轮询走
   * `setTimeout`，与 `vi.useFakeTimers()` 接管的宏任务钟混在一起容易互相等待、
   * 整条用例挂死（实测过一次 15s 超时）。这里全程用 `act` 手动冲刷微任务 +
   * `vi.advanceTimersByTimeAsync` 推进宏任务钟，状态落定后用同步的 `getByTestId`。
   */
  async function submitAndAdvanceToLongrun(hasMountedSkills?: boolean) {
    vi.useFakeTimers();
    render(
      <ChatLiveMessagePanel
        threadId="t"
        bearer="b"
        agents={agents}
        archived={false}
        canLandArtifacts={false}
        {...(hasMountedSkills === undefined ? {} : { hasMountedSkills })}
      />,
    );
    await flushMicrotasks();

    const input = screen.getByTestId("chat-message-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.click(screen.getByTestId("chat-message-submit"));
    await flushMicrotasks();

    expect(screen.getByTestId("chat-message-row-thinking")).toBeInTheDocument();
    // 45 秒阈值之前：hint 不出现。
    expect(screen.queryByTestId("chat-thinking-longrun-hint")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(46_000);
    });
  }

  it("线程挂了 skill ⇒ 45 秒后显示「执行 skill 脚本时可能需要数分钟」", async () => {
    await submitAndAdvanceToLongrun(true);
    const hint = screen.getByTestId("chat-thinking-longrun-hint");
    expect(hint).toHaveTextContent("执行 skill 脚本时可能需要数分钟");
  });

  it("线程没有挂任何 skill（比如 Deep Research 纯问答线程）⇒ 45 秒后改用不特指 skill 的通用措辞，不再误导", async () => {
    await submitAndAdvanceToLongrun(false);
    const hint = screen.getByTestId("chat-thinking-longrun-hint");
    expect(hint).not.toHaveTextContent("skill");
    expect(hint).toHaveTextContent("复杂任务可能需要数分钟");
  });

  it("省略 hasMountedSkills（未接线的调用点）⇒ 按「没挂 skill」处理，不误导", async () => {
    await submitAndAdvanceToLongrun(undefined);
    const hint = screen.getByTestId("chat-thinking-longrun-hint");
    expect(hint).not.toHaveTextContent("skill");
  });
});
