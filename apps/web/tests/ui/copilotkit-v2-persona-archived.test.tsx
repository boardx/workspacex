/**
 * issue #2053 —— CK-P6「生成用户画像」入口平移 + CK-P8 归档线程只读态，钉在真实的
 * `CopilotKitV2Panel` 上（不是钉一个测试里重建的替身组件）。
 *
 * ## 2026-08-30 重设计：从「恒定按钮」改成「建议行里的一条动态 chip」
 *
 * 人类原话「他应该是动态的建议的行为，不能是固定的」——`chat-persona-summary-trigger`
 * 不再是"有能力就渲染、没线程就渲染成灰色"的恒定入口，而是 `FollowUpSuggestions`
 * 建议行里按上下文出现/消失的一条本地 chip（见 `copilotkit-v2-panel-body.tsx` 的
 * `showPersonaSuggestion`）。本文件跟着这次重设计改了两处断言（原②与归档态那条）：
 * 从"渲染但 disabled + title 说明"改成"条件不满足就完全不渲染"——这本身就是
 * 本次重设计要证明的行为，不是妥协。
 *
 * ## 这个测试要防住的几个具体假绿
 *
 * ① **锚点 id 拿错命名空间**。`summarizePersonaFromThread` 的 `messageId` 必须是
 *    `chat_messages.id`；`agent.messages` 里的 AG-UI 流式 id 后端不认识。测试因此
 *    断言的是「调用参数逐字等于 `listMessages` 读回的最后一条的 id」，而不是
 *    「有没有调到」——只断言"调到了"的话，把 `agent.messages` 末条 id 传进去
 *    也照样绿，而那正是「点了才报错的假按钮」。
 * ② **失败被糊成一句通用话**。契约 err 三档（NOT_VISIBLE / NO_WRITE_ROLE /
 *    STORAGE_UNAVAILABLE）用户处置完全不同，断言 reasonCode 原样出现在界面上。
 * ③ **归档只做了个提示、控件照样能点**。归档态逐个断言 input / 发送 / 麦克风都
 *    disabled；画像 chip 归档时整体不渲染（同 `FollowUpSuggestions` 的既有规则：
 *    归档线程不给追问建议，每条 chip 点下去都是一次动作，摆在只读线程上就是
 *    一排假按钮）——断言从"disabled"改成"根本不在"，而不只是断言提示文案在。
 * ④ **成功之后 chip 不消失**。生成一次之后同一条建议还挂在那——用户会以为
 *    "点了但没反应"，或者误以为可以无限重复生成。
 *
 * ⚠ 组件测试不是本 issue 的唯一证据：真实浏览器 e2e
 * （`e2e/copilotkit-v2-persona-archived.spec.ts`）打真栈，是端到端证据。这里钉的是
 * 接线形状与失败态文案——这两件在 jsdom 里能判得比浏览器更精确（可以直接读调用参数）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/** 见 `copilotkit-v2-panel-markdown.test.tsx` 同一段头注：vitest 管线不吃框架的 CSS 副作用导入。 */
const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

const { listMessages, summarizePersonaFromThread, createPersonalThread, listCapabilities } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  summarizePersonaFromThread: vi.fn(),
  createPersonalThread: vi.fn(async () => ({ threadId: "thr-attach", version: 1 })),
  listCapabilities: vi.fn(async () => ({ items: [] })),
}));

vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listMessages, summarizePersonaFromThread, createPersonalThread,
}));
vi.mock("@/lib/live-capabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-capabilities")>()),
  listCapabilities,
}));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { sessionToken: "b", userId: "u", orgIds: ["org-1"], currentOrgId: "org-1", expiresAt: "2099-01-01T00:00:00.000Z" },
  }),
}));
/** 语音输入是既有能力（DA-19g），本测试只关心它在归档态被禁用，不驱动真实采音管线。 */
vi.mock("@/lib/use-asr-draft", () => ({
  useAsrDraft: () => ({
    status: "idle", listening: false, connecting: false, stopping: false, error: null,
    start: vi.fn(), stop: vi.fn(),
    // issue #2130（TW-P0-5⑥）—— `cancel`/`elapsedSeconds`/`level` 是新增字段
    // （`ComposerMicControl` 的录音态面板消费），补进 mock 保持形状与真实 hook
    // 一致；本测试的场景都不触发录音态，值本身不影响这里的断言。
    cancel: vi.fn(), elapsedSeconds: 0, level: 0,
  }),
}));
vi.mock("@/lib/use-audio-input-devices", () => ({
  useAudioInputDevices: () => ({ devices: [], selectedDeviceId: null, select: vi.fn() }),
}));
/** skill 挂载栏（#2020）与本 issue 无关，且它自己会发三条真实请求。 */
vi.mock("@/components/chat/chat-skill-mount-panel", () => ({
  ChatSkillMountPanel: () => null,
}));
/** fabric 建 canvas 在 jsdom 里产不出——同 `chat-diagram-save-gate.test.tsx` 的既有限制。 */
vi.mock("@/components/chat/chat-diagram-fabric", () => ({
  ChatDiagramFabric: (props: { code: string }) => <div data-testid="chat-diagram-fabric-probe">{props.code}</div>,
}));

import { CopilotKit } from "@copilotkit/react-core/v2";
import { ApiError, SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { CopilotKitV2Panel } from "@/components/chat/copilotkit-v2-panel";

const THREAD_ID = "thr-2053";

function msg(id: string, authorKind: "human" | "agent", text: string) {
  return {
    id, authorKind, authorId: "u", agentId: null, text, clientMessageId: null,
    agentRunId: null, replyToMessageId: null, createdAt: "2026-08-25T00:00:00.000Z",
  };
}

const MINDMAP = ["```mermaid", "mindmap", "  root((用户画像))", "    目标", "```"].join("\n");

function mount(props: { archived?: boolean; canGeneratePersona?: boolean; chatThreadId?: string | null }) {
  return render(
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      {/* 生产里这层 Provider 由 `app/chat/copilotkit-v2/layout.tsx` 提供（agent 选择
          跨路由存活）；组件测试里照原样包一层真的 Provider，不 mock 掉那个 hook。 */}
      <CopilotKitV2AgentSelectionProvider>
        <CopilotKitV2Panel
          chatThreadId={props.chatThreadId === undefined ? THREAD_ID : props.chatThreadId}
          archived={props.archived ?? false}
          canGeneratePersona={props.canGeneratePersona ?? false}
        />
      </CopilotKitV2AgentSelectionProvider>
    </CopilotKit>,
  );
}

/**
 * 线程里已有的两条持久化消息；`cm-persona` 只有在画像**真的生成过之后**才出现。
 *
 * ⚠ 这里不能用 `mockResolvedValueOnce` 排队：组件挂载时的历史灌回本身就会消费掉
 *   第一次 `listMessages`（第一版这么写，锚点断言拿到的是 `cm-persona`——被自己的
 *   测试抓了个正着）。改成由 `summarizePersonaFromThread` 的成功回调翻这个开关，
 *   时序与真实后端一致：生成之前读不到那条消息，生成之后才读得到。
 */
let personaGenerated = false;
/**
 * `cm-2` 在**挂载之后**才出现在后端。
 *
 * 这是本文件最要紧的一处编排，不是凑数：只有让「挂载时灌进 `agent.messages` 的那份」
 * 与「点击时后端最新的那份」**真的不一样**，「锚点取自哪一份」才是可判的。第一版
 * 两份一模一样（cm-1 + cm-2 都在挂载时就有），把实现改成拿 `agent.messages` 末条
 * id 照样全绿——本轮的反证实验当场抓到这一点。现在这个编排下，拿内存那份会取到
 * `cm-1`，断言立刻红。
 */
let latePersistedMessage = false;

beforeEach(() => {
  vi.clearAllMocks();
  personaGenerated = false;
  latePersistedMessage = true;
  // 面板内部的 bearer 走 `getStoredSessionToken()`（与历史灌回同一条既有取法），
  // 不是 session context——测试里就按生产的取法把它放进 localStorage。
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "b");
  listMessages.mockImplementation(async () => ({
    messages: [
      msg("cm-1", "human", "我想做一个给设计师的工具"),
      ...(latePersistedMessage ? [msg("cm-2", "agent", "了解，你的目标用户是谁？")] : []),
      ...(personaGenerated ? [msg("cm-persona", "agent", MINDMAP)] : []),
    ],
    nextCursor: null,
  }));
});

describe("CK-P6 生成用户画像（issue #2053）", () => {
  it("①没有 artifact.land 能力 ⇒ 入口根本不渲染（不是渲染后禁用）", async () => {
    mount({ canGeneratePersona: false });
    await waitFor(() => expect(screen.getByTestId("copilotkit-v2-input")).toBeTruthy());
    expect(screen.queryByTestId("chat-persona-summary-trigger")).toBeNull();
  });

  it("②全新对话（还没有持久化线程）⇒ 入口根本不渲染（不是渲染成灰色）", async () => {
    mount({ canGeneratePersona: true, chatThreadId: null });
    await waitFor(() => expect(screen.getByTestId("copilotkit-v2-input")).toBeTruthy());
    expect(screen.queryByTestId("chat-persona-summary-trigger")).toBeNull();
  });

  /**
   * 2026-08-30 补丁二：真实复现——线程**已经建立**（`chatThreadId` 非空）但
   * 一条消息都没有（`listMessages` 读回空数组）。第一版的判据是
   * `initialChatThreadId !== null`，只看"线程存在"，这个场景下照样渲染；
   * 点了就撞见 `runPersonaSummary` 里 `persisted` 为空那条"这条对话还没有
   * 已落库的消息，无法生成画像"——不是渲染 bug，是判据没有真的按"有没有内容"
   * 来判。改成看 `agent.messages.length` 后，这个场景必须不渲染。
   */
  it("②b 线程已建立但一条消息都没有 ⇒ 同样不渲染（不能只看「线程存在」）", async () => {
    listMessages.mockImplementation(async () => ({ messages: [], nextCursor: null }));
    mount({ canGeneratePersona: true, chatThreadId: THREAD_ID });
    await waitFor(() => expect(screen.getByTestId("copilotkit-v2-input")).toBeTruthy());
    expect(screen.queryByTestId("chat-persona-summary-trigger")).toBeNull();
  });

  it("③点击 ⇒ 锚点是 listMessages 读回的最后一条持久化消息 id（不是流式 id），成功后 chip 消失", async () => {
    summarizePersonaFromThread.mockImplementation(async () => {
      personaGenerated = true;
      return {
        artifactId: "art-1", versionId: "v1", contentHash: "h", mode: "draft",
        hasSource: true, sufficient: true, resultMessageId: "cm-persona",
        provenanceBacklink: { conversationId: THREAD_ID, messageId: "cm-2", citations: [] },
      };
    });

    // 挂载时后端只有 cm-1 ⇒ `agent.messages` 灌回的最后一条就是 cm-1。
    latePersistedMessage = false;
    mount({ canGeneratePersona: true });
    const trigger = await screen.findByTestId("chat-persona-summary-trigger");
    await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
    // 等历史真的灌进消息区（不是等一个定时器）——之后再让后端多出一条 cm-2。
    await screen.findByText(/给设计师的工具/);
    latePersistedMessage = true;

    fireEvent.click(trigger);

    // 锚点必须是 cm-2（点击时现读的后端最新一条），不是 cm-1（内存里那份）。
    await waitFor(() => {
      expect(summarizePersonaFromThread).toHaveBeenCalledWith(THREAD_ID, "cm-2", "b");
    });
    // 结果消息经 MarkdownMessage 的 mermaid 围栏通道进入消息流（探针收到 mindmap 源码）。
    await waitFor(() => {
      const probes = screen.queryAllByTestId("chat-diagram-fabric-probe");
      expect(probes.some((p) => (p.textContent ?? "").includes("mindmap"))).toBe(true);
    });
    // ④ 重设计的核心行为：成功之后这条建议从建议行里消失——不是继续挂在那，
    // 不然用户分不清"点了没反应"还是"可以无限重复点"。
    await waitFor(() => {
      expect(screen.queryByTestId("chat-persona-summary-trigger")).toBeNull();
    });
  });

  it("④失败原样回显 reasonCode，不糊成「生成失败」", async () => {
    summarizePersonaFromThread.mockRejectedValue(new ApiError(503, "STORAGE_UNAVAILABLE", undefined));
    mount({ canGeneratePersona: true });
    const trigger = await screen.findByTestId("chat-persona-summary-trigger");
    await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(trigger);

    const err = await screen.findByTestId("chat-persona-summary-error");
    expect(err.textContent).toContain("STORAGE_UNAVAILABLE");
  });
});

describe("CK-P8 归档线程只读态（issue #2053）", () => {
  it("归档 ⇒ 只读提示 + composer 全部写入口禁用（逐个断言，不是只看提示在不在）", async () => {
    mount({ archived: true, canGeneratePersona: true });

    const notice = await screen.findByTestId("chat-composer-archived");
    expect(notice.textContent).toContain("该对话已归档");

    expect((screen.getByTestId("copilotkit-v2-input") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId("copilotkit-v2-send") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("chat-task-workbench-composer-mic") as HTMLButtonElement).disabled).toBe(true);
    // 2026-08-30 重设计：画像 chip 现在挂在 `FollowUpSuggestions` 建议行里，
    // 归档时整条建议行都不渲染（同追问 chip 的既有规则），不是渲染成灰色。
    expect(screen.queryByTestId("chat-persona-summary-trigger")).toBeNull();
  });

  it("未归档 ⇒ 同样这些控件可用（反证：上一条不是因为组件根本没渲染出来才「禁用」）", async () => {
    mount({ archived: false, canGeneratePersona: true });
    await waitFor(() => expect(screen.getByTestId("copilotkit-v2-input")).toBeTruthy());

    expect(screen.queryByTestId("chat-composer-archived")).toBeNull();
    expect((screen.getByTestId("copilotkit-v2-input") as HTMLInputElement).disabled).toBe(false);
    // issue #2130（TW-P0-5④）—— 发送按钮现在多一条真实禁用理由（空输入），
    // 与这里要证明的事（archived=false 本身不禁用）正交：先填字，只隔离
    // "archived 这一个变量"对 disabled 的影响，不隔离"输入是否为空"。
    fireEvent.change(screen.getByTestId("copilotkit-v2-input"), { target: { value: "hi" } });
    expect((screen.getByTestId("copilotkit-v2-send") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("chat-task-workbench-composer-mic") as HTMLButtonElement).disabled).toBe(false);
  });
});
