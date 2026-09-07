/**
 * 2026-09-07 人类实测反馈 —— 「chat 的 UI，composer 在录音的过程中文字多了以后无法
 * 上下滚动来查看文本，不能向下滚动看下面的文字」。
 *
 * ## 根因（这个测试要防住的假绿）
 *
 * 录音期 composer 里真正**看得见**的文字不是 `<textarea>` 自己（它被刷成
 * `text-transparent`），而是铺在它底下那层镜像 `chat-task-workbench-composer-live-transcript`
 * （深色=已落定 / 浅灰=识别中，见 `copilotkit-v2-panel-body.tsx` 该处头注）。镜像是
 * `absolute inset-0 overflow-hidden`：既不跟随 `<textarea>` 的滚动，自己也没有滚动
 * 条。于是 `<textarea>` 原生能滚是**真的**、但滚了以后可见文字**一动不动**——只断言
 * 「输入框是 overflow auto / 能收到 scroll 事件」会绿，而用户仍然看不到下面的文字。
 * 所以这里断言的是**镜像层的 `scrollTop`**，那才是"用户能不能看到下面的文字"。
 *
 * 三条钉子：
 * ① 用户滚输入框 ⇒ 镜像跟着滚（能往下翻看已转录的文字）。
 * ② 转录持续追加、用户没往上翻 ⇒ 自动滚到底（最新一句始终可见）。
 * ③ 用户往上翻之后 ⇒ 新文字不再把他拽回底部（正在读上文时不被打断）。
 *
 * jsdom 不做布局（`scrollHeight`/`clientHeight` 恒为 0），三个只读属性用
 * `Object.defineProperty` 钉死——与 `copilotkit-v2-panel-scroll-to-bottom.test.tsx`
 * 同一套做法：测的是「算完之后接线对不对」，不是绕过被测代码。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";

const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

const { listMessages, speechStore } = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let snapshot = { baseText: "", committedText: "", partialText: "" };
  return {
    listMessages: vi.fn(
      async (): Promise<import("@/lib/live-chat").ListMessagesOut> => ({ messages: [], nextCursor: null }),
    ),
    speechStore: {
      subscribe(fn: () => void) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      get() {
        return snapshot;
      },
      set(next: Partial<{ baseText: string; committedText: string; partialText: string }>) {
        snapshot = { ...snapshot, ...next };
        listeners.forEach((fn) => fn());
      },
      reset() {
        snapshot = { baseText: "", committedText: "", partialText: "" };
        listeners.forEach((fn) => fn());
      },
    },
  };
});
vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listMessages,
}));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { sessionToken: "b", userId: "u", orgIds: ["org-1"], currentOrgId: "org-1", expiresAt: "2099-01-01T00:00:00.000Z" },
  }),
}));
// 录音态由测试驱动：`listening: true` 常开，转录文字通过 `speechStore` 逐段追加。
vi.mock("@/lib/use-asr-draft", async () => {
  const React = await import("react");
  return {
    appendTranscript: (base: string, addition: string) => (addition === "" ? base : base === "" ? addition : `${base} ${addition}`),
    useAsrDraft: () => {
      const segments = React.useSyncExternalStore(speechStore.subscribe, speechStore.get, speechStore.get);
      return {
        status: "listening", listening: true, connecting: false, stopping: false, error: null,
        start: vi.fn(), stop: vi.fn(), cancel: vi.fn(),
        elapsedSeconds: 3, level: 0.4,
        ...segments,
      };
    },
  };
});
vi.mock("@/lib/use-audio-input-devices", () => ({
  useAudioInputDevices: () => ({ devices: [], selectedDeviceId: null, select: vi.fn() }),
}));
vi.mock("@/components/chat/chat-skill-mount-panel", () => ({
  ChatSkillMountPanel: () => null,
}));
vi.mock("@/components/chat/chat-diagram-fabric", () => ({
  ChatDiagramFabric: () => null,
}));

import { CopilotKit } from "@copilotkit/react-core/v2";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { CopilotKitV2Panel } from "@/components/chat/copilotkit-v2-panel";

function mount() {
  return render(
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2AgentSelectionProvider>
        <CopilotKitV2Panel chatThreadId="thr-rec-scroll" archived={false} canGeneratePersona={false} />
      </CopilotKitV2AgentSelectionProvider>
    </CopilotKit>,
  );
}

/** 钉死 jsdom 不提供的布局属性：输入框只有 3 行可视高度，内容比它高得多。 */
function stubTextareaLayout(el: HTMLElement, layout: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(el, "scrollHeight", { value: layout.scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: layout.clientHeight, configurable: true });
  Object.defineProperty(el, "scrollTop", { value: 0, configurable: true, writable: true });
}

async function mountRecording() {
  mount();
  const textarea = await waitFor(() => screen.getByTestId("copilotkit-v2-input"));
  const mirror = await waitFor(() => screen.getByTestId("chat-task-workbench-composer-live-transcript"));
  stubTextareaLayout(textarea, { scrollHeight: 900, clientHeight: 72 });
  Object.defineProperty(mirror, "scrollTop", { value: 0, configurable: true, writable: true });
  return { textarea, mirror };
}

beforeEach(() => {
  vi.clearAllMocks();
  speechStore.reset();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "b");
});

describe("composer 录音期文字滚动（2026-09-07 人类实测）", () => {
  it("① 用户滚输入框 ⇒ 底下的可见镜像跟着滚（这才是「能翻到下面的文字」）", async () => {
    const { textarea, mirror } = await mountRecording();
    (textarea as HTMLElement & { scrollTop: number }).scrollTop = 320;
    fireEvent.scroll(textarea);
    expect(mirror.scrollTop).toBe(320);
  });

  it("② 转录持续追加、用户没往上翻 ⇒ 输入框与镜像都自动滚到底，最新一句可见", async () => {
    const { textarea, mirror } = await mountRecording();
    act(() => speechStore.set({ committedText: "第一段".repeat(60) }));
    await waitFor(() => expect((textarea as HTMLElement & { scrollTop: number }).scrollTop).toBe(900));
    expect(mirror.scrollTop).toBe(900);
  });

  it("③ 用户往上翻之后 ⇒ 新转录不再把他拽回底部；滚回底部后恢复自动跟随", async () => {
    const { textarea, mirror } = await mountRecording();
    // 往上翻到顶（距底部远大于容差）。
    (textarea as HTMLElement & { scrollTop: number }).scrollTop = 0;
    fireEvent.scroll(textarea);

    act(() => speechStore.set({ partialText: "又说了一句" }));
    await waitFor(() => expect(mirror.scrollTop).toBe(0));
    expect((textarea as HTMLElement & { scrollTop: number }).scrollTop).toBe(0);

    // 用户自己滚回底部 ⇒ 重新跟随。
    (textarea as HTMLElement & { scrollTop: number }).scrollTop = 900 - 72;
    fireEvent.scroll(textarea);
    act(() => speechStore.set({ partialText: "再说一句" }));
    await waitFor(() => expect((textarea as HTMLElement & { scrollTop: number }).scrollTop).toBe(900));
  });
});
