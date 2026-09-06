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

import { ProjectRecordingPanel } from "@/components/chat/workbench/project-recording-panel";
import { ChatRecordingPanel } from "@/components/chat/chat-recording-panel";

let asrHandlers: Parameters<typeof openAsrStream>[3] | null = null;

describe("ChatRecordingPanel — D10 转录中行内卡（issue #2285）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    asrHandlers = null;
    readTranscript.mockResolvedValue({ segments: [] });
    endThreadRecording.mockResolvedValue(undefined);
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

  it("项目工作台只读仍读取持久转录，但不能创建录音", async () => {
    window.localStorage.setItem("wsx.recordingSession.t", "saved-session");
    readTranscript.mockResolvedValue({ segments: [{ id: "seg-1", text: "已保存的转录" }] });
    render(<ProjectRecordingPanel projectId="p" threadId="t" userId="u" bearer="b" canWrite={false} archived={false} />);
    await flush();
    expect(readTranscript).toHaveBeenCalledWith("saved-session", "b");
    expect(screen.getByTestId("chat-live-transcript")).toHaveTextContent("已保存的转录");
    expect(screen.getByTestId("chat-live-recording-start")).toBeDisabled();
    fireEvent.click(screen.getByTestId("chat-live-recording-start"));
    expect(startThreadRecording).not.toHaveBeenCalled();
  });

  it("项目工作台录音使用真实scope，归档禁录，切个人线程移除入口", async () => {
    const view = render(<ProjectRecordingPanel projectId="p" threadId="t" userId="u" bearer="b" canWrite archived />);
    expect(screen.getByTestId("chat-live-recording-start")).toBeDisabled();
    view.rerender(<ProjectRecordingPanel projectId="p" threadId="t" userId="u" bearer="b" canWrite archived={false} />);
    fireEvent.click(screen.getByTestId("chat-live-recording-start"));
    await flush();
    expect(startThreadRecording).toHaveBeenCalledWith("t", "p", "u", "b");
    fireEvent.click(screen.getByTestId("chat-live-recording-stop"));
    await flush();
    view.rerender(<ProjectRecordingPanel projectId={null} threadId="personal" userId="u" bearer="b" canWrite archived={false} />);
    expect(screen.queryByTestId("chat-recording-panel")).toBeNull();
  });

  it("切线程后前一场转录的迟到读取不能进入新线程", async () => {
    window.localStorage.setItem("wsx.recordingSession.a", "session-a");
    let finish!: (value: unknown) => void;
    readTranscript.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(<ProjectRecordingPanel projectId="p" threadId="a" userId="u" bearer="b" canWrite={false} archived={false} />);
    await flush();
    view.rerender(<ProjectRecordingPanel projectId="p" threadId="b" userId="u" bearer="b" canWrite={false} archived={false} />);
    await act(async () => finish({ segments: [{ id: "old", text: "线程A私有转录" }] }));
    expect(screen.queryByText("线程A私有转录")).toBeNull();
    expect(screen.getByTestId("chat-live-transcript-empty")).toBeInTheDocument();
  });

  it("录音中失去写权限会停止当前采音，保留转录读取", async () => {
    const stop = vi.fn(async () => {});
    openAsrStream.mockResolvedValue({ stop });
    const view = render(<ProjectRecordingPanel projectId="p" threadId="t" userId="u" bearer="b" canWrite archived={false} />);
    fireEvent.click(screen.getByTestId("chat-live-recording-start"));
    await flush();
    view.rerender(<ProjectRecordingPanel projectId="p" threadId="t" userId="u" bearer="b" canWrite={false} archived={false} />);
    await flush();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(endThreadRecording).toHaveBeenCalledWith("sess-1", "b");
    expect(screen.getByTestId("chat-live-recording-start")).toBeDisabled();
  });

  it.each(["start", "anchor", "open"] as const)("%s 等待期间撤回权限，迟到响应不得留下采音", async (boundary) => {
    let resolve!: (value: unknown) => void;
    const deferred = new Promise((done) => { resolve = done; });
    const stopped = vi.fn(async () => {});
    if (boundary === "start") startThreadRecording.mockReturnValue(deferred);
    if (boundary === "anchor") listMessages.mockReturnValue(deferred);
    if (boundary === "open") openAsrStream.mockReturnValue(deferred);
    const view = render(<ProjectRecordingPanel projectId="p" threadId="t" userId="u" bearer="b" canWrite archived={false} />);
    fireEvent.click(screen.getByTestId("chat-live-recording-start"));
    await flush();
    view.rerender(<ProjectRecordingPanel projectId="p" threadId="t" userId="u" bearer="b" canWrite={false} archived={false} />);
    await act(async () => resolve(boundary === "start"
      ? { sessionId: "sess-1", tracks: [{ trackId: "track-1" }] }
      : boundary === "anchor" ? { messages: [{ id: "m-1" }] } : { stop: stopped }));
    await flush();
    if (boundary === "open") expect(stopped).toHaveBeenCalledTimes(1);
    else expect(openAsrStream).not.toHaveBeenCalled();
    expect(endThreadRecording).toHaveBeenCalledWith("sess-1", "b");
    expect(screen.getByTestId("chat-live-recording-status")).toHaveAttribute("data-phase", "idle");
    expect(screen.getByTestId("chat-live-recording-start")).toBeDisabled();
  });

  it("离开录音线程释放采音流并结束自己的录音会话", async () => {
    const stop = vi.fn(async () => {});
    openAsrStream.mockResolvedValue({ stop });
    const view = render(<ProjectRecordingPanel projectId="p" threadId="t" userId="u" bearer="b" canWrite archived={false} />);
    fireEvent.click(screen.getByTestId("chat-live-recording-start"));
    await flush();
    view.unmount();
    await flush();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(endThreadRecording).toHaveBeenCalledWith("sess-1", "b");
  });

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

    // 回归钉子：`core-loop.spec.ts` 步骤 7（唯一接入发布门的浏览器 e2e）在折叠态
    // （`transcriptExpanded` 默认 false）断言 `chat-live-recording-status` 的
    // `data-phase` 转到 "recording"——这个状态锚点绝不能被行内卡的折叠逻辑一并
    // 折叠掉，否则该 e2e 会在「起了没等到状态」这一行超时（真实回归过一次）。
    expect(screen.getByTestId("chat-live-recording-status")).toHaveAttribute("data-phase", "recording");

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
