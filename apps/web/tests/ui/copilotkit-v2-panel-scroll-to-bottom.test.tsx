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
  useAsrDraft: () => ({
    status: "idle", listening: false, connecting: false, stopping: false, error: null,
    start: vi.fn(), stop: vi.fn(),
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
