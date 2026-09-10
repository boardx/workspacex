/**
 * 2026-09-10 人类实测反馈（截图两条）——
 * ①「chat 录音，必须要先停止，才可以发送，现在没有停止，发送按钮也可以用」：录音进行中
 *   输入框里的文字还在被 ASR 持续改写，这时候能点发送 ⇒ 发出去的是一句被截断到"点下去
 *   那一帧"的半截话，随后到达的 `asr.final` 还会继续往已经清空的输入框里写字。
 * ②「下面的绿色提醒要过 5 秒自动消失，不要一直停留」：「已转录 N 字」是一条已完成动作的
 *   回执，看过就没用了，却一直占着 composer 底部 48px。
 *
 * 这里的录音态由测试驱动（`speechStore`），走的是真实的 `useComposerVoiceSession` +
 * 真实的 composer 渲染路径——只有最底层"真的开麦克风/连 WS"的 `useAsrDraft` 被替身，
 * 与 `copilotkit-v2-composer-recording-scroll.test.tsx` 同一套做法。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";

const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

type SpeechSnapshot = {
  status: "idle" | "connecting" | "listening" | "stopping";
  baseText: string;
  committedText: string;
  partialText: string;
};

const { listMessages, speechStore } = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let snapshot: SpeechSnapshot = { status: "idle", baseText: "", committedText: "", partialText: "" };
  return {
    listMessages: vi.fn(
      async (): Promise<import("@/lib/live-chat").ListMessagesOut> => ({ messages: [], nextCursor: null }),
    ),
    speechStore: {
      subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); },
      get() { return snapshot; },
      set(next: Partial<SpeechSnapshot>) {
        snapshot = { ...snapshot, ...next };
        listeners.forEach((fn) => fn());
      },
      reset() {
        snapshot = { status: "idle", baseText: "", committedText: "", partialText: "" };
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
vi.mock("@/lib/use-asr-draft", async () => {
  const React = await import("react");
  return {
    appendTranscript: (base: string, addition: string) => (addition === "" ? base : base === "" ? addition : `${base} ${addition}`),
    useAsrDraft: () => {
      const snapshot = React.useSyncExternalStore(speechStore.subscribe, speechStore.get, speechStore.get);
      return {
        status: snapshot.status,
        listening: snapshot.status === "listening",
        connecting: snapshot.status === "connecting",
        stopping: snapshot.status === "stopping",
        error: null,
        start: () => speechStore.set({ status: "listening" }),
        stop: () => speechStore.set({ status: "idle" }),
        cancel: () => speechStore.set({ status: "idle", committedText: "", partialText: "" }),
        elapsedSeconds: 5,
        level: 0.4,
        baseText: snapshot.baseText,
        committedText: snapshot.committedText,
        partialText: snapshot.partialText,
      };
    },
  };
});
vi.mock("@/lib/use-audio-input-devices", () => ({
  useAudioInputDevices: () => ({ devices: [], selectedDeviceId: null, select: vi.fn() }),
}));
vi.mock("@/components/chat/chat-skill-mount-panel", () => ({ ChatSkillMountPanel: () => null }));
vi.mock("@/components/chat/chat-diagram-fabric", () => ({ ChatDiagramFabric: () => null }));

import { CopilotKit } from "@copilotkit/react-core/v2";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { CopilotKitV2Panel } from "@/components/chat/copilotkit-v2-panel";

function mount() {
  return render(
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2AgentSelectionProvider>
        <CopilotKitV2Panel chatThreadId="thr-rec-send-gate" archived={false} canGeneratePersona={false} />
      </CopilotKitV2AgentSelectionProvider>
    </CopilotKit>,
  );
}

/** 先打字（保证"发送被禁用"不是因为输入框为空），再开录音。 */
async function mountWithDraftRecording() {
  mount();
  const textarea = await waitFor(() => screen.getByTestId("copilotkit-v2-input"));
  fireEvent.change(textarea, { target: { value: "Thank you." } });
  const send = screen.getByTestId("copilotkit-v2-send");
  await waitFor(() => expect(send).not.toBeDisabled());
  act(() => speechStore.set({ status: "listening", baseText: "Thank you.", committedText: "已经转出来的一段" }));
  await waitFor(() => expect(screen.getByTestId("chat-mic-listening")).toBeTruthy());
  return { textarea, send };
}

beforeEach(() => {
  vi.clearAllMocks();
  speechStore.reset();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "b");
});
afterEach(() => { vi.useRealTimers(); });

describe("composer 录音期的发送闸门（2026-09-10 人类实测）", () => {
  it("① 正在录音（有正文）⇒ 发送按钮禁用，提示先点「停止」", async () => {
    const { send } = await mountWithDraftRecording();
    expect(send).toBeDisabled();
    expect(send.getAttribute("data-send-state")).toBe("disabled");
    expect(send.getAttribute("title")).toContain("停止");
  });

  it("① 正在录音时按 Enter 不发送（输入框内容原样留着）", async () => {
    const { textarea } = await mountWithDraftRecording();
    fireEvent.keyDown(textarea, { key: "Enter" });
    await Promise.resolve();
    expect((textarea as HTMLTextAreaElement).value).toBe("Thank you.");
    expect(screen.getByTestId("chat-mic-listening")).toBeTruthy();
  });

  it("① 连接中 / 正在停止同样禁用发送；停止落定后恢复可发送", async () => {
    const { send } = await mountWithDraftRecording();
    act(() => speechStore.set({ status: "stopping" }));
    await waitFor(() => expect(send).toBeDisabled());

    act(() => speechStore.set({ status: "idle" }));
    await waitFor(() => expect(send).not.toBeDisabled());
  });

  it("② 「已转录」绿色状态栏 5 秒后自动消失，输入框内容不受影响", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { textarea } = await mountWithDraftRecording();
    act(() => speechStore.set({ status: "idle" }));
    await waitFor(() => expect(screen.getByTestId("chat-task-workbench-composer-transcribed")).toBeTruthy());

    act(() => { vi.advanceTimersByTime(5_000); });
    await waitFor(() => expect(screen.queryByTestId("chat-task-workbench-composer-transcribed")).toBeNull());
    expect((textarea as HTMLTextAreaElement).value).toBe("Thank you.");
  });
});
