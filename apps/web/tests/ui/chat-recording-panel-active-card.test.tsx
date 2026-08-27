/**
 * issue #2285（D10 前半 ④，rev-uiux 复评）—— 转录中卡。
 *
 * 调查结论：`ChatRecordingPanel` 此前**恒显**空闲态文案（「会话录音 / 未在录音。/
 * 本会话还没有转录。」），即便 `phase === "recording"` 也不换样——参照图（
 * `ui-preview/chat-main-ref/chat-main-default.png`）在录音中是一张带计时 + 最新一句 +
 * 「查看转录 / 停止录音」的行内卡。这里只换**展示层**：`phase`/`partial`/`segments`
 * 都是组件里已经真实存在的状态（真实 `startThreadRecording`/`openAsrStream`/
 * `endThreadRecording`/`readTranscript` 驱动），不引入任何新的 mock 数据源。
 *
 * 「停止录音」接的是已有的真实 `stop()`（内部调 `endThreadRecording` + 重读
 * `readTranscript`）——这里钉住点击后真的调用了它，不是一个新皮肤包着假动作。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const {
  startThreadRecording, endThreadRecording, readTranscript, openAsrStream, listMessages,
} = vi.hoisted(() => ({
  startThreadRecording: vi.fn(),
  endThreadRecording: vi.fn(),
  readTranscript: vi.fn(),
  openAsrStream: vi.fn(),
  listMessages: vi.fn(),
}));

vi.mock("@/lib/live-asr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-asr")>()),
  startThreadRecording, endThreadRecording, readTranscript, openAsrStream,
}));
vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listMessages,
}));

import { ChatRecordingPanel } from "@/components/chat/chat-recording-panel";

let asrHandlers: Parameters<typeof openAsrStream>[3] | null = null;

describe("ChatRecordingPanel — D10 转录中行内卡（issue #2285）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    asrHandlers = null;
    readTranscript.mockResolvedValue({ segments: [] });
    listMessages.mockResolvedValue({ messages: [{ id: "m-1" }], nextCursor: null });
    startThreadRecording.mockResolvedValue({ sessionId: "sess-1", tracks: [{ trackId: "track-1" }] });
    openAsrStream.mockImplementation(async (_sessionId, _trackId, _messageId, handlers) => {
      asrHandlers = handlers;
      return { stop: vi.fn(async () => undefined) };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function flush() {
    for (let i = 0; i < 8; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await Promise.resolve(); });
    }
  }

  it("空闲态不显示转录中行内卡", async () => {
    render(<ChatRecordingPanel threadId="t" projectId="p" userId="u" bearer="b" />);
    await flush();
    expect(screen.queryByTestId("chat-recording-active-card")).toBeNull();
    expect(screen.getByTestId("chat-live-transcript-empty")).toBeInTheDocument();
  });

  it("开始录音后换成行内卡：计时 + 最新一句 + 查看转录/停止录音，真实调用 openAsrStream", async () => {
    vi.useFakeTimers();
    render(<ChatRecordingPanel threadId="t" projectId="p" userId="u" bearer="b" />);
    await flush();

    fireEvent.click(screen.getByTestId("chat-live-recording-start"));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(openAsrStream).toHaveBeenCalled();
    const card = screen.getByTestId("chat-recording-active-card");
    expect(card).toBeInTheDocument();
    expect(screen.getByTestId("chat-recording-elapsed")).toHaveTextContent(/^\d{2}:\d{2}$/);

    // 计时真的在走，不是写死的字符串。
    const before = screen.getByTestId("chat-recording-elapsed").textContent;
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    const after = screen.getByTestId("chat-recording-elapsed").textContent;
    expect(after).not.toBe(before);

    // 最新一句复用真实的 partial 转录状态（onPartial 回调），不是编的占位文案。
    act(() => { asrHandlers?.onPartial("周宁：客户董事会给的窗口是十八个月"); });
    expect(screen.getByTestId("chat-recording-latest-line")).toHaveTextContent("周宁：客户董事会给的窗口是十八个月");

    expect(screen.getByTestId("chat-recording-view-transcript")).toBeInTheDocument();
    const stopButton = screen.getByTestId("chat-live-recording-stop");
    expect(stopButton).toHaveTextContent("停止录音");

    fireEvent.click(stopButton);
    await flush();
    expect(endThreadRecording).toHaveBeenCalledWith("sess-1", "b");
    // 停止之后回到空闲态展示，行内卡不再渲染。
    expect(screen.queryByTestId("chat-recording-active-card")).toBeNull();
  });

  it("「查看转录」展开/收起完整转录区——真实 DOM 切换，不是点了没反应的按钮", async () => {
    render(<ChatRecordingPanel threadId="t" projectId="p" userId="u" bearer="b" />);
    await flush();
    fireEvent.click(screen.getByTestId("chat-live-recording-start"));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    // 折叠态：行内卡只显示一行摘要，完整转录区（含空态文案）不占屏幕。
    expect(screen.queryByTestId("chat-live-transcript")).toBeNull();
    fireEvent.click(screen.getByTestId("chat-recording-view-transcript"));
    expect(screen.getByTestId("chat-live-transcript")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("chat-recording-view-transcript"));
    expect(screen.queryByTestId("chat-live-transcript")).toBeNull();
  });
});
