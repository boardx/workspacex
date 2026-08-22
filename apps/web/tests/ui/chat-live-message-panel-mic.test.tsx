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

// #946：spread 真实 live-chat 保留 ATTACHMENT_LIMITS / ATTACHMENT_MIME_ALLOWLIST /
// uploadAttachment（composer 附件 UI 在模块加载期就读这些常量），只覆盖本测试驱动的函数。
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
    // 2026-08-20 —— 真实的 `handle.stop()`（`live-asr-draft.ts`）要等上游确认收尾才 resolve，
    // 从来不是同步完成。这里原来直接同步调 `onFinished()`（`async () => {...}` 函数体里没有
    // 任何 `await`，等同于同步执行），于是"点了停止"到"onFinished 真的触发"之间**没有一个
    // 可观察的微任务窗口**——这正是 devapp 那个"终止转录也不能正常终止"的 bug 长期未被这份
    // 测试文件测出来的原因：mock 比真实上游快得多，快到把 stopping 这个中间态盖住了。
    await Promise.resolve();
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

const agents = [{ id: "agent-real", abbr: "AR", name: "真实 Agent", duty: "只读研究", roleLabel: "研究", presence: "present" as const }];

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

  /**
   * 2026-08-20 devapp 实测反馈：「点击 mic 图标以后要反应半天」「终止转录也不能正常终止」。
   * 根因是状态机原来只有 idle/listening 两头——`openAsrDraftStream` 对真实上游而言不是
   * 0 秒（麦克风权限弹窗 + WS 握手），旧版这段真实等待期里界面**没有任何变化**。
   *
   * 这条测试的关键：断言发生在 `fireEvent.click` **之后、`await stream.promise` 之前**
   * ——这正是旧版全程沉默的那个窗口。此前的 `deferredStream()` mock 让
   * `openAsrDraftStream` 在同一个微任务里就 resolve，之前的用例从未在这个窗口里断言过
   * 任何东西，所以这个缺口一直没被测出来（真实上游的这段窗口是几百毫秒到几秒，
   * 不是本测试环境里的一个微任务，但状态机本身该不该在这段等待里说话，是一件与
   * "等多久"无关、可以在同步窗口里钉死的事）。
   */
  it("shows a 'connecting' state synchronously on click, before the network handshake settles (2026-08-20 devapp: 反应半天)", async () => {
    const stream = deferredStream();
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());

    const micButton = screen.getByTestId("chat-mic-button");
    fireEvent.click(micButton);

    // 就在这里——mock 的 resolve 还没被微任务队列处理，仍然是"点了但还没连上"那一刻。
    expect(micButton).toHaveAttribute("data-mic-status", "connecting");
    expect(micButton).toBeDisabled();
    expect(micButton).toHaveAttribute("aria-label", "正在连接语音识别…");
    expect(screen.getByTestId("chat-mic-connecting")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-mic-listening")).not.toBeInTheDocument();

    await act(() => stream.promise);
    await waitFor(() => expect(micButton).toHaveAttribute("data-mic-status", "listening"));
    expect(screen.queryByTestId("chat-mic-connecting")).not.toBeInTheDocument();
  });

  /**
   * 同上，收尾那一侧：`handle.stop()` 要等上游确认（真实上游下最多
   * `KERNEL_ASR_FINISH_GRACE_MS`，默认 15 秒），这段等待期界面也必须说"正在停止"，
   * 不能一片空白到用户以为"点了没反应，是不是卡住了"。
   */
  it("shows a 'stopping' state synchronously on the stop click, before the upstream confirms (2026-08-20 devapp: 终止转录也不能正常终止)", async () => {
    const stream = deferredStream();
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());

    const micButton = screen.getByTestId("chat-mic-button");
    fireEvent.click(micButton);
    await act(() => stream.promise);
    await waitFor(() => expect(micButton).toHaveAttribute("data-mic-status", "listening"));

    fireEvent.click(micButton); // 第二次点击 = 停止

    // 就在这里——`stop` mock 里的 `onFinished()` 还没被微任务队列处理。
    expect(micButton).toHaveAttribute("data-mic-status", "stopping");
    expect(micButton).toBeDisabled();
    expect(micButton).toHaveAttribute("aria-label", "正在停止…");
    expect(screen.getByTestId("chat-mic-stopping")).toBeInTheDocument();

    await waitFor(() => expect(micButton).toHaveAttribute("data-mic-status", "idle"));
    expect(screen.queryByTestId("chat-mic-stopping")).not.toBeInTheDocument();
  });

  it("realtime-asr 增补 A（§7）：设备下拉挂在麦克风旁，选中的 deviceId 传给采音层", async () => {
    // 记住一个设备（§7.3-3）。本测试环境 mediaDevices 无 enumerateDevices，设备列表为空，
    // 空列表下记忆保留（“不存在”只是“还没列出来”），selectedDeviceId 即该 id。
    window.localStorage.setItem("wsx.micDeviceId", "mic-remembered");
    const stream = deferredStream();
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());

    // 下拉触发器与麦克风按钮同处一行。
    expect(screen.getByTestId("chat-mic-device-select")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("chat-mic-button"));
    await act(() => stream.promise);
    // 采音层收到的正是记住的设备（第二个参数 deps.deviceId）。
    const deps = openAsrDraftStream.mock.calls[0]![1] as { deviceId?: string };
    expect(deps.deviceId).toBe("mic-remembered");
    window.localStorage.removeItem("wsx.micDeviceId");
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
