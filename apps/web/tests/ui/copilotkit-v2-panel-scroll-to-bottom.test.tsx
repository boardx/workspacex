/**
 * issue #2071 —— 消息区"跳到最新"：贴底自动跟随 + 离开底部后浮现"↓回到最新"按钮 +
 * `Ctrl/Cmd+End` 键盘快捷键。钉在真实的 `CopilotKitV2Panel` 上（挂载方式与
 * `copilotkit-v2-persona-archived.test.tsx` 同一套，不是重建一个替身组件）。
 *
 * jsdom 不实现真实布局（`scrollHeight`/`clientHeight` 恒为 0），滚动位置类断言这里
 * 用 `Object.defineProperty` 在消息容器上钉死这三个只读属性、再 `fireEvent.scroll`
 * 触发处理函数——这是测试 `onScroll` 回调本身要不要显示按钮的标准做法，不是绕过被
 * 测代码；`isScrolledNearBottom` 纯函数另有独立单测，两者互补（纯函数测阈值算对没算
 * 对，这里测"算完之后 UI/事件接线对不对"）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

const { listMessages, listCapabilities } = vi.hoisted(() => ({
  // 显式声明返回类型——空数组字面量会被推成 `never[]`，后面 `mockImplementation`
  // 换成非空数组时报"不能赋给 never[]"，而不是真的类型不对。
  listMessages: vi.fn(
    async (): Promise<import("@/lib/live-chat").ListMessagesOut> => ({ messages: [], nextCursor: null }),
  ),
  listCapabilities: vi.fn(async () => ({ items: [] })),
}));
vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listMessages,
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
vi.mock("@/lib/use-asr-draft", () => ({
  appendTranscript: (base: string, addition: string) => (addition === "" ? base : base === "" ? addition : `${base} ${addition}`),
  useAsrDraft: () => ({
    status: "idle", listening: false, connecting: false, stopping: false, error: null,
    start: vi.fn(), stop: vi.fn(),
    // issue #2130（TW-P0-5⑥）—— 补齐新字段，形状与真实 hook 一致；本测试场景
    // 不触发录音态，值本身不影响这里的断言。
    cancel: vi.fn(), elapsedSeconds: 0, level: 0,
    baseText: "", committedText: "", partialText: "",
  }),
}));
vi.mock("@/lib/use-audio-input-devices", () => ({
  useAudioInputDevices: () => ({ devices: [], selectedDeviceId: null, select: vi.fn() }),
}));
vi.mock("@/components/chat/chat-skill-mount-panel", () => ({
  ChatSkillMountPanel: () => null,
}));
vi.mock("@/components/chat/chat-diagram-fabric", () => ({
  ChatDiagramFabric: (props: { code: string }) => <div data-testid="chat-diagram-fabric-probe">{props.code}</div>,
}));

import { CopilotKit } from "@copilotkit/react-core/v2";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { CopilotKitV2Panel, isScrolledNearBottom, SCROLL_BOTTOM_THRESHOLD_PX } from "@/components/chat/copilotkit-v2-panel";

function mount() {
  return render(
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2AgentSelectionProvider>
        <CopilotKitV2Panel chatThreadId="thr-2071" archived={false} canGeneratePersona={false} />
      </CopilotKitV2AgentSelectionProvider>
    </CopilotKit>,
  );
}

/** 在真实 DOM 节点上钉死 jsdom 不提供的三个布局只读属性 + `scrollTo` 探针。 */
function stubLayout(el: HTMLElement, layout: { scrollHeight: number; scrollTop: number; clientHeight: number }) {
  Object.defineProperty(el, "scrollHeight", { value: layout.scrollHeight, configurable: true });
  Object.defineProperty(el, "scrollTop", { value: layout.scrollTop, configurable: true, writable: true });
  Object.defineProperty(el, "clientHeight", { value: layout.clientHeight, configurable: true });
  el.scrollTo = vi.fn();
  return el.scrollTo as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "b");
  listMessages.mockImplementation(async () => ({
    messages: [
      { id: "cm-1", authorKind: "human" as const, authorId: "u", agentId: null, text: "你好", clientMessageId: null, agentRunId: null, replyToMessageId: null, createdAt: "2026-08-25T00:00:00.000Z" },
      { id: "cm-2", authorKind: "agent" as const, authorId: "u", agentId: null, text: "在的", clientMessageId: null, agentRunId: null, replyToMessageId: null, createdAt: "2026-08-25T00:00:01.000Z" },
    ],
    nextCursor: null,
  }));
});

describe("isScrolledNearBottom —— 纯函数阈值判定", () => {
  it("距底部小于阈值 ⇒ true", () => {
    expect(isScrolledNearBottom(1000, 1000 - 500 - (SCROLL_BOTTOM_THRESHOLD_PX - 1), 500)).toBe(true);
  });
  it("恰好贴底（0px）⇒ true", () => {
    expect(isScrolledNearBottom(1000, 500, 500)).toBe(true);
  });
  it("距底部大于等于阈值 ⇒ false（往上翻阅中）", () => {
    expect(isScrolledNearBottom(1000, 1000 - 500 - SCROLL_BOTTOM_THRESHOLD_PX, 500)).toBe(false);
  });
});

describe("CopilotKitV2Panel 消息区跳到最新（issue #2071）", () => {
  it("贴底时不显示悬浮按钮；往上翻离开底部后按钮出现，点击后回到底部且状态复位", async () => {
    mount();
    const container = await waitFor(() => screen.getByTestId("copilotkit-v2-messages"));
    // 初始 isAtBottom=true（组件默认值），此时不该有按钮。
    expect(screen.queryByTestId("copilotkit-v2-scroll-to-bottom")).toBeNull();

    // 模拟往上翻：滚动位置远离底部（大于阈值）。
    const scrollToSpy = stubLayout(container, { scrollHeight: 2000, scrollTop: 0, clientHeight: 500 });
    fireEvent.scroll(container);
    expect(await screen.findByTestId("copilotkit-v2-scroll-to-bottom")).toBeInTheDocument();

    // 点击按钮 ⇒ 调用 scrollTo(滚到底) 且按钮消失（isAtBottom 复位为 true）。
    fireEvent.click(screen.getByTestId("copilotkit-v2-scroll-to-bottom"));
    expect(scrollToSpy).toHaveBeenCalledWith(expect.objectContaining({ top: 2000 }));
    await waitFor(() => expect(screen.queryByTestId("copilotkit-v2-scroll-to-bottom")).toBeNull());
  });

  // issue #2857（2026-09-06 devapp 人类实测）—— 消息区可以滚过底部进入整屏空白。
  // 根因：滚动容器自己不是定位元素，内容里任何 `position:absolute` 的后代（真栈实测
  // 抓到的是运行中插话表单的 `sr-only` <Label>）以容器**外面**那层 `relative` 包装为
  // 包含块，落在内容底部的静态位置——那个位置在滚动容器之外、可视区之下，于是撑大了
  // 外层 `main`（`overflow-y-auto`）的可滚动高度：滚轮在消息区滚到头后接着把整列
  // 往上推，露出一整屏 `main` 的底色。滚动容器自己成为定位上下文，绝对定位后代就被
  // 收进它的 scrollable overflow，外层再也量不到它。
  it("滚动容器自身是定位上下文（issue #2857：绝对定位后代不得撑大外层 main）", async () => {
    mount();
    const container = await waitFor(() => screen.getByTestId("copilotkit-v2-messages"));
    expect(container.classList.contains("relative")).toBe(true);
    // 反证同一条事实的另一面：容器外那层包装仍然是 FAB 的定位层（既有 #2096 契约不变）。
    expect(container.parentElement?.classList.contains("relative")).toBe(true);
  });

  // 2026-09-02 人类实测："滚到底部的那个箭头的逻辑是错误的"——两条回归钉子。
  it("按钮不在滚动容器内部（否则会跟着内容一起滚走，停在某条消息中间）", async () => {
    mount();
    const container = await waitFor(() => screen.getByTestId("copilotkit-v2-messages"));
    stubLayout(container, { scrollHeight: 2000, scrollTop: 0, clientHeight: 500 });
    fireEvent.scroll(container);
    const button = await screen.findByTestId("copilotkit-v2-scroll-to-bottom");
    expect(container.contains(button)).toBe(false);
    // 与滚动容器并列在同一个定位包装层里：`bottom-3` 才是相对可视区、不随内容滚动。
    expect(button.parentElement).toBe(container.parentElement);
  });

  it("程序化滚动（点按钮/自动跟随）途中的 scroll 事件不把贴底态翻回去；用户滚轮介入后才算离开底部", async () => {
    mount();
    const container = await waitFor(() => screen.getByTestId("copilotkit-v2-messages"));
    stubLayout(container, { scrollHeight: 2000, scrollTop: 0, clientHeight: 500 });
    fireEvent.scroll(container);
    await screen.findByTestId("copilotkit-v2-scroll-to-bottom");

    fireEvent.click(screen.getByTestId("copilotkit-v2-scroll-to-bottom"));
    await waitFor(() => expect(screen.queryByTestId("copilotkit-v2-scroll-to-bottom")).toBeNull());
    // 平滑滚动动画途中：位置离底部还远，但这是我们自己发起的滚动——按钮不该冒出来。
    (container as HTMLElement & { scrollTop: number }).scrollTop = 700;
    fireEvent.scroll(container);
    expect(screen.queryByTestId("copilotkit-v2-scroll-to-bottom")).toBeNull();
    // 抵达底部：标记解除。
    (container as HTMLElement & { scrollTop: number }).scrollTop = 1500;
    fireEvent.scroll(container);
    expect(screen.queryByTestId("copilotkit-v2-scroll-to-bottom")).toBeNull();
    // 用户真的往上滚（滚轮 + 位置离开底部）⇒ 按钮出现。
    fireEvent.wheel(container);
    (container as HTMLElement & { scrollTop: number }).scrollTop = 0;
    fireEvent.scroll(container);
    expect(await screen.findByTestId("copilotkit-v2-scroll-to-bottom")).toBeInTheDocument();
  });

  // PR #2530 review 第 1 条：标记不能卡死。两种此前会卡住的情形各钉一个用例。
  it("拖滚动条（pointerdown，不是 wheel）中断程序化滚动 ⇒ 之后离开底部的 scroll 被如实采纳", async () => {
    mount();
    const container = await waitFor(() => screen.getByTestId("copilotkit-v2-messages"));
    stubLayout(container, { scrollHeight: 2000, scrollTop: 0, clientHeight: 500 });
    fireEvent.scroll(container);
    await screen.findByTestId("copilotkit-v2-scroll-to-bottom");
    fireEvent.click(screen.getByTestId("copilotkit-v2-scroll-to-bottom"));
    await waitFor(() => expect(screen.queryByTestId("copilotkit-v2-scroll-to-bottom")).toBeNull());

    // 平滑滚动途中用户按住滚动条滑块往上拖：没有 wheel，只有 pointerdown + scroll。
    fireEvent.pointerDown(container);
    (container as HTMLElement & { scrollTop: number }).scrollTop = 100;
    fireEvent.scroll(container);
    expect(await screen.findByTestId("copilotkit-v2-scroll-to-bottom")).toBeInTheDocument();
  });

  it("程序化滚动没有产生任何 scroll 事件（auto 且位置没变）⇒ 标记在有界超时后自动解除，不吞掉后续用户滚动", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mount();
      const container = await waitFor(() => screen.getByTestId("copilotkit-v2-messages"));
      stubLayout(container, { scrollHeight: 2000, scrollTop: 0, clientHeight: 500 });
      fireEvent.scroll(container);
      await screen.findByTestId("copilotkit-v2-scroll-to-bottom");
      fireEvent.click(screen.getByTestId("copilotkit-v2-scroll-to-bottom"));
      await waitFor(() => expect(screen.queryByTestId("copilotkit-v2-scroll-to-bottom")).toBeNull());

      // 这次程序化滚动一个 scroll 事件都没发出（jsdom 的 scrollTo 是探针）。超时前：
      // 用户滚动仍被当作程序化途中吞掉——这是标记的设计；超时后必须放行。
      (container as HTMLElement & { scrollTop: number }).scrollTop = 0;
      await vi.advanceTimersByTimeAsync(1_100);
      fireEvent.scroll(container);
      expect(await screen.findByTestId("copilotkit-v2-scroll-to-bottom")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("scrollend 事件解除标记（支持该事件的浏览器不必等超时）", async () => {
    mount();
    const container = await waitFor(() => screen.getByTestId("copilotkit-v2-messages"));
    stubLayout(container, { scrollHeight: 2000, scrollTop: 0, clientHeight: 500 });
    fireEvent.scroll(container);
    await screen.findByTestId("copilotkit-v2-scroll-to-bottom");
    fireEvent.click(screen.getByTestId("copilotkit-v2-scroll-to-bottom"));
    await waitFor(() => expect(screen.queryByTestId("copilotkit-v2-scroll-to-bottom")).toBeNull());

    container.dispatchEvent(new Event("scrollend"));
    (container as HTMLElement & { scrollTop: number }).scrollTop = 0;
    fireEvent.scroll(container);
    expect(await screen.findByTestId("copilotkit-v2-scroll-to-bottom")).toBeInTheDocument();
  });

  it("Ctrl+End 跳到最新：往上翻后按快捷键，等价于点击按钮", async () => {
    mount();
    const container = await waitFor(() => screen.getByTestId("copilotkit-v2-messages"));
    const scrollToSpy = stubLayout(container, { scrollHeight: 2000, scrollTop: 0, clientHeight: 500 });
    fireEvent.scroll(container);
    await screen.findByTestId("copilotkit-v2-scroll-to-bottom");

    fireEvent.keyDown(window, { key: "End", ctrlKey: true });
    expect(scrollToSpy).toHaveBeenCalledWith(expect.objectContaining({ top: 2000 }));
    await waitFor(() => expect(screen.queryByTestId("copilotkit-v2-scroll-to-bottom")).toBeNull());
  });

  it("普通 End（无修饰键）不触发跳转——不能吞掉输入框里「移到行尾」的原生行为", async () => {
    mount();
    const container = await waitFor(() => screen.getByTestId("copilotkit-v2-messages"));
    const scrollToSpy = stubLayout(container, { scrollHeight: 2000, scrollTop: 0, clientHeight: 500 });
    fireEvent.scroll(container);
    await screen.findByTestId("copilotkit-v2-scroll-to-bottom");

    fireEvent.keyDown(window, { key: "End" });
    expect(scrollToSpy).not.toHaveBeenCalled();
    // 按钮仍在——普通 End 没有把状态复位成"已回到底部"。
    expect(screen.getByTestId("copilotkit-v2-scroll-to-bottom")).toBeInTheDocument();
  });
});
