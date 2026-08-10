/**
 * #726 —— composer 麦克风按钮的语音转录状态机测试。
 *
 * 验收标准（`.harness/instructions/chat-ux-acceptance-criteria.md` 第 5 项）："麦克风按钮是否
 * 能实时把语音转成文字填进输入框，转录过程中用户能看到实时文字更新（不是录完一段才整体填入），
 * 且转录结果可编辑后再发送"。
 *
 * 底层是服务端代理的 `WS /chat/asr-draft`（`apps/web/lib/live-asr-draft.ts` →
 * `apps/api/src/interface/ws/asr-draft.gateway.ts` → 阿里云百炼实时 ASR，key 只在服务端）
 * ——不是浏览器直连、不是浏览器原生 `SpeechRecognition`。这里只 mock `@/lib/live-asr-draft`
 * 这一层网络边界（与 `chat-read-screen.test.tsx` mock `@/lib/agent-run-stream` 同一套路），
 * 驱动 `chat-live-message-panel.tsx` + `use-asr-draft.ts` 里真实的状态转换逻辑。
 *
 * 浏览器能力探测（`isCaptureSupported`）用 `vi.stubGlobal` 挂/摘 `WebSocket`/
 * `mediaDevices.getUserMedia`/`AudioContext`（参照 `personal-chat-screen.test.tsx` 里
 * `mockMatchMedia` 的写法），验证"不支持"分支真的会触发，不是靠 mock 绕过去的假绿。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LiveRecordingError } from "@/lib/live-recording";
import type { AsrDraftStreamHandle, AsrDraftStreamHandlers } from "@/lib/live-asr-draft";

const { listMessages, createMessage, getAgentRun, openAgentRunStream, openAsrDraftStream } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  createMessage: vi.fn(),
  getAgentRun: vi.fn(),
  openAgentRunStream: vi.fn(() => new Promise<void>(() => {})),
  openAsrDraftStream: vi.fn(),
}));

vi.mock("@/lib/live-chat", () => ({
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

import { ChatLiveMessagePanel } from "@/components/chat/chat-live-message-panel";

function stubCaptureSupport(supported: boolean) {
  if (supported) {
    vi.stubGlobal("WebSocket", class {} as unknown as typeof WebSocket);
    vi.stubGlobal("AudioContext", class {} as unknown as typeof AudioContext);
    Object.defineProperty(window.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });
  } else {
    vi.stubGlobal("WebSocket", undefined);
    Object.defineProperty(window.navigator, "mediaDevices", { configurable: true, value: undefined });
  }
}

/** A controllable fake for `openAsrDraftStream` — the test drives `handlers` directly. */
function deferredStream() {
  let capturedHandlers: AsrDraftStreamHandlers | null = null;
  const stop = vi.fn(async () => {
    capturedHandlers?.onFinished();
  });
  const handle: AsrDraftStreamHandle = { stop };
  const promise = new Promise<AsrDraftStreamHandle>((resolve) => {
    openAsrDraftStream.mockImplementation(async (handlers: AsrDraftStreamHandlers) => {
      capturedHandlers = handlers;
      resolve(handle);
      return handle;
    });
  });
  return {
    get handlers() {
      return capturedHandlers;
    },
    handle,
    promise,
  };
}

const agents = [{ id: "agent-real", abbr: "AR", name: "真实 Agent", duty: "只读研究", presence: "present" as const }];

describe("ChatLiveMessagePanel — composer 麦克风按钮（issue #726，服务端代理 ASR）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubCaptureSupport(true);
    listMessages.mockResolvedValue({ messages: [], nextCursor: null });
    createMessage.mockResolvedValue({
      message: { id: "m-1", authorKind: "human", authorId: "u", agentId: null, text: "x", clientMessageId: null, agentRunId: null, replyToMessageId: null, createdAt: "2026-01-01T00:00:00.000Z" },
      agentRunId: "run-1",
      runStatus: "queued",
    });
    getAgentRun.mockResolvedValue({
      runId: "run-1", threadId: "t", inputMessageId: "m-1", agentId: "agent-real", agentVersionId: "v1",
      skillVersionIds: [], modelProvider: "p", modelId: "m", status: "queued", error: null,
      resultMessageId: null, steps: [], createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the mic button and shows a visible 'listening' state after the server-proxied stream opens", async () => {
    const stream = deferredStream();
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());

    const micButton = screen.getByTestId("chat-mic-button");
    expect(micButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(micButton);
    expect(openAsrDraftStream).toHaveBeenCalledTimes(1);
    await act(() => stream.promise);

    await waitFor(() => expect(micButton).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByTestId("chat-mic-listening")).toBeInTheDocument();
  });

  it("fills the textbox in real time from asr.partial frames, then commits asr.final — not all-at-once after recording ends", async () => {
    const stream = deferredStream();
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("chat-mic-button"));
    await act(() => stream.promise);
    const input = screen.getByTestId("chat-message-input") as HTMLTextAreaElement;

    // Partial (interim) result arrives while still speaking — shows up immediately.
    act(() => stream.handlers!.onPartial("你好世"));
    expect(input.value).toBe("你好世");

    act(() => stream.handlers!.onPartial("你好世界"));
    expect(input.value).toBe("你好世界");

    // Final commits; a fresh partial starts appending after it.
    act(() => stream.handlers!.onFinal("你好世界。"));
    expect(input.value).toBe("你好世界。");

    act(() => stream.handlers!.onPartial("再"));
    expect(input.value).toBe("你好世界。 再");
  });

  it("appends onto text the user already typed, instead of overwriting it", async () => {
    const stream = deferredStream();
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());

    const input = screen.getByTestId("chat-message-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "已经手打的内容" } });

    fireEvent.click(screen.getByTestId("chat-mic-button"));
    await act(() => stream.promise);
    act(() => stream.handlers!.onFinal("追加的语音"));
    expect(input.value).toBe("已经手打的内容 追加的语音");
  });

  it("stops listening on a second click, leaves the transcript editable, and requires a manual send", async () => {
    const stream = deferredStream();
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());

    const micButton = screen.getByTestId("chat-mic-button");
    fireEvent.click(micButton);
    await act(() => stream.promise);
    act(() => stream.handlers!.onFinal("转录完成"));

    fireEvent.click(micButton);
    await waitFor(() => expect(stream.handle.stop).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(micButton).toHaveAttribute("aria-pressed", "false"));
    expect(screen.queryByTestId("chat-mic-listening")).not.toBeInTheDocument();
    expect(createMessage).not.toHaveBeenCalled();

    const input = screen.getByTestId("chat-message-input") as HTMLTextAreaElement;
    expect(input.value).toBe("转录完成");
    fireEvent.change(input, { target: { value: "转录完成，手动改了一下" } });
    expect(input.value).toBe("转录完成，手动改了一下");

    fireEvent.click(screen.getByTestId("chat-message-submit"));
    await waitFor(() => expect(createMessage).toHaveBeenCalledTimes(1));
    expect(createMessage.mock.calls[0]?.[1]).toMatchObject({ text: "转录完成，手动改了一下" });
  });

  it("shows a clear, non-silent message when the browser has no capture/WebSocket support", async () => {
    stubCaptureSupport(false);
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("chat-mic-button"));
    expect(openAsrDraftStream).not.toHaveBeenCalled();
    expect(screen.getByTestId("chat-mic-error")).toHaveTextContent("不支持语音输入");
  });

  it("shows a clear, non-silent message when microphone permission is denied", async () => {
    openAsrDraftStream.mockRejectedValue(
      new LiveRecordingError({ kind: "permission-denied", message: "麦克风权限被拒绝。请在浏览器地址栏的权限设置里允许本站使用麦克风后重试。" }),
    );
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("chat-mic-button"));
    await waitFor(() => expect(screen.getByTestId("chat-mic-error")).toHaveTextContent("麦克风权限被拒绝"));
    expect(screen.getByTestId("chat-mic-button")).toHaveAttribute("aria-pressed", "false");
  });

  it("shows a clear, non-silent message when the server reports ASR_NOT_CONFIGURED", async () => {
    const stream = deferredStream();
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("chat-mic-button"));
    await act(() => stream.promise);
    act(() => stream.handlers!.onError("ASR_NOT_CONFIGURED"));

    await waitFor(() => expect(screen.getByTestId("chat-mic-error")).toHaveTextContent("尚未配置语音转写服务"));
  });

  it("disables the mic button on an archived (read-only) thread", async () => {
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={true} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());

    expect(screen.getByTestId("chat-mic-button")).toBeDisabled();
  });
});
