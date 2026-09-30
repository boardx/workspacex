/**
 * Chat 语音模式全屏通话界面 `RealtimeVoiceSession` 的状态测试（ADR-121）。
 * 用假 `connect` 驱动：连接中 → 通话中（在听/思考中/在说）、实时字幕、静音、打断、挂断、
 * 模型未配置 / 数字人不可用（友好文案，无原始错误码）、麦克风被拒、断线重连。
 */
import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeVoiceSession } from "@/components/chat/realtime-voice-session";
import {
  OmniConversationStartError,
  type OmniConversationHandlers,
  type OmniConversationTarget,
  type openOmniConversation,
} from "@/lib/live-omni-conversation";

const persona = { agentId: "agent-dh-01", name: "研究员小周", subtitle: "行业研究", avatarKey: "dh-01-researcher" };

interface FakeCall { target: OmniConversationTarget; handlers: OmniConversationHandlers; handle: { stop: ReturnType<typeof vi.fn>; cancelResponse: ReturnType<typeof vi.fn>; setMuted: ReturnType<typeof vi.fn> } }

function fakeConnect(opts: { fail?: Error } = {}) {
  const calls: FakeCall[] = [];
  const connect = (async (target: string | OmniConversationTarget, handlers: OmniConversationHandlers) => {
    if (opts.fail) throw opts.fail;
    const handle = { stop: vi.fn(async () => {}), cancelResponse: vi.fn(), setMuted: vi.fn() };
    calls.push({ target: target as OmniConversationTarget, handlers, handle });
    return handle;
  }) as unknown as typeof openOmniConversation;
  return { connect, calls };
}

function renderSession(connect: typeof openOmniConversation, over: Partial<React.ComponentProps<typeof RealtimeVoiceSession>> = {}) {
  const onOpenChange = vi.fn();
  const onEnded = vi.fn();
  const resolveThreadId = vi.fn(async () => "thread-1");
  const utils = render(
    <RealtimeVoiceSession open onOpenChange={onOpenChange} persona={persona} resolveThreadId={resolveThreadId} onEnded={onEnded} connect={connect} {...over} />,
  );
  return { ...utils, onOpenChange, onEnded, resolveThreadId };
}

const status = () => screen.getByTestId("realtime-voice-status");

afterEach(() => vi.useRealTimers());

describe("RealtimeVoiceSession", () => {
  it("connects with threadId + selected agent (no model/voice from the client) and walks the live states", async () => {
    const { connect, calls } = fakeConnect();
    renderSession(connect);
    expect(status()).toHaveTextContent("正在连接");
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.target).toEqual({ threadId: "thread-1", agentId: "agent-dh-01" });
    const h = calls[0]!.handlers;

    act(() => h.onReady("qwen"));
    expect(status()).toHaveTextContent("空闲");
    expect(screen.getByRole("dialog")).toHaveAccessibleName("与研究员小周实时对话");

    act(() => h.onUserSpeech(true));
    expect(status()).toHaveAttribute("data-activity", "listening");
    expect(status()).toHaveTextContent("在听");
    act(() => h.onUserTranscript("本周进展", true));
    act(() => h.onUserSpeech(false));
    expect(status()).toHaveTextContent("思考中");
    act(() => { h.onAssistantAudio(true); h.onAssistantTranscript("好的，", false); h.onAssistantTranscript("本周完成三件事", false); });
    expect(status()).toHaveTextContent("在说");
    expect(screen.getByTestId("realtime-voice-caption-user")).toHaveTextContent("本周进展");
    expect(screen.getByTestId("realtime-voice-caption-assistant")).toHaveTextContent("好的，本周完成三件事");
    expect(screen.getByTestId("realtime-voice-portrait")).toHaveAttribute("data-activity", "speaking");
  });

  it("mutes (button and M shortcut), interrupts while speaking, and hangs up", async () => {
    const { connect, calls } = fakeConnect();
    const { onOpenChange } = renderSession(connect);
    await waitFor(() => expect(calls).toHaveLength(1));
    const { handlers: h, handle } = calls[0]!;
    act(() => h.onReady("qwen"));

    fireEvent.click(screen.getByTestId("realtime-voice-mute"));
    expect(handle.setMuted).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId("realtime-voice-mute")).toHaveAttribute("aria-pressed", "true");
    expect(status()).toHaveTextContent("已静音");
    const scope = document.getElementById("realtime-voice-session-scope")!;
    expect(scope).toHaveTextContent("已静音，对方听不到你");
    expect(scope).not.toHaveTextContent("可随时开口打断");
    fireEvent.keyDown(screen.getByTestId("realtime-voice-status"), { key: "m" });
    expect(scope).toHaveTextContent("可随时开口打断");
    expect(handle.setMuted).toHaveBeenLastCalledWith(false);

    expect(screen.getByTestId("realtime-voice-interrupt")).toBeDisabled();
    act(() => h.onAssistantAudio(true));
    fireEvent.click(screen.getByTestId("realtime-voice-interrupt"));
    expect(handle.cancelResponse).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("realtime-voice-hangup"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stops the session and reports persisted message ids when closed", async () => {
    const { connect, calls } = fakeConnect();
    const { rerender, onEnded, onOpenChange, resolveThreadId } = renderSession(connect);
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => { calls[0]!.handlers.onReady("qwen"); calls[0]!.handlers.onTurnPersisted?.("user", "m-1"); calls[0]!.handlers.onTurnPersisted?.("assistant", "m-2"); });
    rerender(<RealtimeVoiceSession open={false} onOpenChange={onOpenChange} persona={persona} resolveThreadId={resolveThreadId} onEnded={onEnded} connect={connect} />);
    expect(calls[0]!.handle.stop).toHaveBeenCalled();
    await waitFor(() => expect(onEnded).toHaveBeenCalledWith({ threadId: "thread-1", persistedMessageIds: ["m-1", "m-2"] }));
  });

  it("waits for the hangup to settle: a turn persisted during stop() is still reported to onEnded", async () => {
    const calls: FakeCall[] = [];
    const connect = (async (target: string | OmniConversationTarget, handlers: OmniConversationHandlers) => {
      const handle = {
        // 服务端在挂断收尾时才落下最后一句
        stop: vi.fn(async () => { await new Promise((r) => setTimeout(r, 20)); handlers.onTurnPersisted?.("user", "m-last"); }),
        cancelResponse: vi.fn(), setMuted: vi.fn(),
      };
      calls.push({ target: target as OmniConversationTarget, handlers, handle });
      return handle;
    }) as unknown as typeof openOmniConversation;
    const { rerender, onEnded, onOpenChange, resolveThreadId } = renderSession(connect);
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => calls[0]!.handlers.onReady("qwen"));
    rerender(<RealtimeVoiceSession open={false} onOpenChange={onOpenChange} persona={persona} resolveThreadId={resolveThreadId} onEnded={onEnded} connect={connect} />);
    expect(onEnded).not.toHaveBeenCalled();
    await waitFor(() => expect(onEnded).toHaveBeenCalledWith({ threadId: "thread-1", persistedMessageIds: ["m-last"] }));
  });

  it("subtitle under the name: shows the role one-liner, hidden when it just repeats the name", async () => {
    const { connect } = fakeConnect();
    const { unmount } = renderSession(connect);
    expect(screen.getByTestId("realtime-voice-subtitle")).toHaveTextContent("行业研究");
    unmount();
    renderSession(fakeConnect().connect, { persona: { ...persona, name: "研究与知识分析师", subtitle: "研究与知识分析师" } });
    expect(screen.queryByTestId("realtime-voice-subtitle")).toBeNull();
    expect(screen.getAllByText("研究与知识分析师")).toHaveLength(1);
  });

  it("controls carry visible labels + aria-label/tooltip, and a live mic level meter follows capture RMS", async () => {
    const { connect, calls } = fakeConnect();
    renderSession(connect);
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => calls[0]!.handlers.onReady("qwen"));
    for (const [id, label] of [["realtime-voice-mute", "静音"], ["realtime-voice-hangup", "挂断"], ["realtime-voice-interrupt", "打断"]] as const) {
      const button = screen.getByTestId(id);
      expect(button.getAttribute("aria-label")).toBeTruthy();
      expect(button.getAttribute("title")).toBeTruthy();
      expect(button.parentElement).toHaveTextContent(label);
    }
    const meter = screen.getByTestId("realtime-voice-input-level");
    expect(meter).toHaveAttribute("aria-valuenow", "0");
    act(() => calls[0]!.handlers.onInputLevel?.(0.5));
    expect(meter).toHaveAttribute("aria-valuenow", "50");
  });

  it("shows a friendly not-configured state (no raw codes) without retry", async () => {
    const { connect, calls } = fakeConnect();
    renderSession(connect);
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => { calls[0]!.handlers.onError("实时语音模型尚未配置", "NOT_CONFIGURED"); calls[0]!.handlers.onClosed(); });
    expect(status()).toHaveTextContent("实时语音尚未开通");
    const alert = screen.getByTestId("realtime-voice-error");
    expect(alert).toHaveTextContent("管理员配置实时语音模型后即可使用");
    expect(alert.textContent).not.toMatch(/NOT_CONFIGURED|Error/);
    expect(screen.queryByTestId("realtime-voice-retry")).toBeNull();
    expect(calls).toHaveLength(1); // no reconnect after a fatal error
  });

  it("shows agent-unavailable as a friendly fatal state", async () => {
    const { connect, calls } = fakeConnect();
    renderSession(connect);
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => { calls[0]!.handlers.onError("x", "AGENT_UNAVAILABLE"); calls[0]!.handlers.onClosed(); });
    expect(status()).toHaveTextContent("这个数字人暂不可用");
  });

  it("explains a denied microphone and offers retry", async () => {
    const { connect } = fakeConnect({ fail: new OmniConversationStartError("mic-denied") });
    renderSession(connect);
    await waitFor(() => expect(screen.getByTestId("realtime-voice-error")).toHaveTextContent("麦克风权限被拒绝"));
    expect(screen.getByTestId("realtime-voice-retry")).toBeInTheDocument();
  });

  it("reconnects after an unexpected drop, then gives up with a retry button", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { connect, calls } = fakeConnect();
    renderSession(connect);
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => calls[0]!.handlers.onReady("qwen"));
    act(() => calls[0]!.handlers.onClosed());
    expect(status()).toHaveTextContent("正在重连");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_600); });
    await waitFor(() => expect(calls).toHaveLength(2));
    act(() => calls[1]!.handlers.onClosed());
    await act(async () => { await vi.advanceTimersByTimeAsync(1_600); });
    await waitFor(() => expect(calls).toHaveLength(3));
    act(() => calls[2]!.handlers.onClosed());
    expect(status()).toHaveAttribute("data-phase", "error");
    fireEvent.click(screen.getByTestId("realtime-voice-retry"));
    await waitFor(() => expect(calls).toHaveLength(4));
    expect(calls[3]!.target).toEqual({ threadId: "thread-1", agentId: "agent-dh-01" });
  });

  it("states that tools/skills/workflows are out of scope in voice mode", async () => {
    const { connect } = fakeConnect();
    renderSession(connect);
    expect(screen.getByText(/语音模式暂不支持调用工具、技能和工作流/)).toBeInTheDocument();
  });

  it("renders live captions + level meter from a loopback-style turn; muted swaps the speak hint; save notice only while live", async () => {
    const { connect, calls } = fakeConnect();
    renderSession(connect);
    await waitFor(() => expect(calls).toHaveLength(1));
    const h = calls[0]!.handlers;
    expect(screen.queryByText(/文字记录会保存/)).toBeNull(); // not live yet: no saving claim
    act(() => h.onReady("omni-loopback"));
    expect(screen.getByText(/本次通话的文字记录会保存到此对话/)).toBeInTheDocument();
    expect(screen.getByTestId("realtime-voice-caption-user")).toHaveTextContent("直接开口说话");
    act(() => h.onInputLevel?.(0.6));
    expect(screen.getByTestId("realtime-voice-input-level")).toHaveAttribute("aria-valuenow", "60");
    act(() => { h.onUserSpeech(true); h.onUserTranscript("（模拟语音）你好，", false); });
    expect(screen.getByTestId("realtime-voice-caption-user")).toHaveTextContent("（模拟语音）你好，");
    act(() => { h.onUserTranscript("（模拟语音）你好，我想了解一下产品方案", true); h.onUserSpeech(false); });
    act(() => { h.onAssistantTranscript("我是研究员小周，", false); h.onAssistantTranscript("好的。", false); });
    expect(screen.getByTestId("realtime-voice-caption-user")).toHaveTextContent("我想了解一下产品方案");
    expect(screen.getByTestId("realtime-voice-caption-assistant")).toHaveTextContent("我是研究员小周，好的。");
    // muted with no caption yet → hint must not tell the user to speak
    const second = fakeConnect();
    renderSession(second.connect);
    await waitFor(() => expect(second.calls).toHaveLength(1));
    act(() => second.calls[0]!.handlers.onReady("m"));
    fireEvent.click(screen.getAllByTestId("realtime-voice-mute").at(-1) as HTMLElement);
    expect(screen.getAllByTestId("realtime-voice-caption-user").at(-1)).toHaveTextContent("已静音，点击取消静音后说话");
    expect(screen.getAllByTestId("realtime-voice-caption-user").at(-1)).not.toHaveTextContent("直接开口说话");
  });
});
