/** Canonical panel continuity: real SDK renderer; only IO and browser canvas are replaced with probes. */
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

const diagramMountCount = vi.hoisted(() => ({ current: 0 }));
vi.mock("@/components/chat/chat-diagram-fabric", () => ({
  ChatDiagramFabric: (props: { code: string }) => {
    const React = require("react");
    React.useEffect(() => {
      diagramMountCount.current += 1;
    }, []);
    return React.createElement("div", { "data-testid": "chat-diagram-fabric-probe" }, props.code);
  },
}));

const { listMessages, listCapabilities } = vi.hoisted(() => ({
  listMessages: vi.fn(async () => ({
    messages: [
      {
        id: "cm-1", authorKind: "agent" as const, authorId: "u", agentId: null,
        text: "```mermaid\nflowchart TD\n  A --> B\n```",
        clientMessageId: null, agentRunId: "run-1", replyToMessageId: null,
        createdAt: "2026-08-26T00:00:00.000Z",
      },
    ],
    nextCursor: null,
  })),
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
vi.mock("@/components/session/session-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/session/session-provider")>()),
  useSession: () => ({
    session: { sessionToken: "b", userId: "u", orgIds: ["org-1"], currentOrgId: "org-1", expiresAt: "2099-01-01T00:00:00.000Z" },
  }),
}));
vi.mock("@/lib/use-asr-draft", () => ({
  useAsrDraft: () => ({
    status: "idle", errorReason: null, listening: false, connecting: false, stopping: false, error: null,
    start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), elapsedSeconds: 0, level: 0,
    baseText: "", committedText: "", partialText: "",
  }),
  appendTranscript: (base: string, addition: string) => (addition === "" ? base : base === "" ? addition : `${base} ${addition}`),
}));
vi.mock("@/lib/use-audio-input-devices", () => ({
  useAudioInputDevices: () => ({ devices: [], selectedDeviceId: null, select: vi.fn() }),
}));
vi.mock("@/components/chat/chat-skill-mount-panel", () => ({
  ChatSkillMountPanel: () => null,
}));

import { I18nProvider, useI18n } from "@/lib/i18n/provider";
const voice = vi.hoisted(() => ({
  phase: "idle" as import("@/lib/use-composer-voice-session").ComposerVoicePhase, totalSeconds: 7, transcribedChars: 4,
  silentSeconds: 0, silenceHint: false, autoPause: true, deviceMenuRequest: 0,
  setAutoPause: vi.fn(), start: vi.fn(), pause: vi.fn(), finish: vi.fn(),
  discard: vi.fn(), undo: vi.fn(), dismiss: vi.fn(), requestDeviceMenu: vi.fn(),
}));
vi.mock("@/lib/use-composer-voice-session", async (original) => ({
  ...(await original<typeof import("@/lib/use-composer-voice-session")>()),
  useComposerVoiceSession: () => voice,
}));

import { CopilotKit } from "@copilotkit/react-core/v2";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { CopilotKitV2Panel } from "@/components/chat/copilotkit-v2-panel";

function SwitchLanguage() {
  const { setLocale } = useI18n();
  return <button onClick={() => setLocale("zh-CN")}>switch language</button>;
}
function mount() {
  return render(
    <I18nProvider initialLocale="en"><SwitchLanguage /><CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2AgentSelectionProvider>
        <CopilotKitV2Panel chatThreadId="thr-2132" archived={false} canGeneratePersona={false} />
      </CopilotKitV2AgentSelectionProvider>
    </CopilotKit></I18nProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  voice.phase = "idle";
  diagramMountCount.current = 0;
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "b");
});

it("updates canonical composer chrome without remounting message content, refetching history or replacing a draft/caret", async () => {
  mount();
  await screen.findByTestId("chat-diagram-fabric-probe");
  const input = await screen.findByTestId("copilotkit-v2-input") as HTMLTextAreaElement;
  expect(input.getAttribute("placeholder")).toBe("Describe your goal. Shift+Enter for a new line, Enter to send.");
  fireEvent.change(input, { target: { value: "保留我的 draft 🌍" } });
  input.setSelectionRange(2, 4);
  const loads = listMessages.mock.calls.length;
  const message = screen.getByTestId("chat-diagram-fabric-probe");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("copilotkit-v2-input")).toBe(input);
  expect(input.value).toBe("保留我的 draft 🌍");
  expect([input.selectionStart, input.selectionEnd]).toEqual([2, 4]);
  expect(screen.getByTestId("chat-diagram-fabric-probe")).toBe(message);
  expect(diagramMountCount.current).toBe(1);
  expect(listMessages).toHaveBeenCalledTimes(loads);
});

it("updates recording chrome while preserving the ongoing voice controller and send gate", async () => {
  voice.phase = "listening";
  mount();
  await screen.findByTestId("chat-diagram-fabric-probe");
  expect(screen.getByText("Listening 00:07")).toBeTruthy();
  const stop = screen.getByTestId("chat-task-workbench-composer-recording-confirm");
  const input = screen.getByTestId("copilotkit-v2-input");
  fireEvent.change(input, { target: { value: "尚未结束的语音内容" } });
  const send = screen.getByTestId("copilotkit-v2-send");
  expect(send.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("chat-task-workbench-composer-recording-confirm")).toBe(stop);
  expect(stop.textContent).toContain("停止");
  expect(screen.getByTestId("copilotkit-v2-input")).toBe(input);
  expect(send.hasAttribute("disabled")).toBe(true);
  expect(voice.start).not.toHaveBeenCalled();
  expect(voice.finish).not.toHaveBeenCalled();
  expect(voice.discard).not.toHaveBeenCalled();
});

it.each([
  ["connecting", "Connecting to speech recognition"],
  ["stopping", "Stopping recording"],
  ["paused", "Paused 00:07"],
  ["done", "Transcribed 4 characters"],
  ["error", "Speech recognition is temporarily unavailable"],
] as const)("localizes the actual canonical %s recording state", async (phase, title) => {
  voice.phase = phase;
  mount();
  await screen.findByTestId("chat-diagram-fabric-probe");
  expect(screen.getByText(title)).toBeTruthy();
});
