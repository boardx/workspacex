import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AsrDraftStreamHandlers } from "@/lib/live-asr-draft";
import { InterviewVoiceInput } from "@/components/itv/interview-voice-input";
import { InterviewIntakeStep } from "@/components/itv/interview-intake-step";
const { open } = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/lib/live-asr-draft", async (original) => ({ ...await original<typeof import("@/lib/live-asr-draft")>(), openAsrDraftStream: open }));
let handlers: AsrDraftStreamHandlers;
beforeEach(() => {
  open.mockReset(); localStorage.clear();
  vi.stubGlobal("WebSocket", class {}); vi.stubGlobal("AudioContext", class {});
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn() } });
  open.mockImplementation(async (value: AsrDraftStreamHandlers) => { handlers = value; return { stop: async () => undefined }; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it("keeps interim text local and appends final stop text exactly once", async () => {
  const append = vi.fn(); const busy = vi.fn();
  render(<InterviewVoiceInput sessionToken="voice-session" onAppend={append} onBusyChange={busy} />);
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await screen.findByRole("button", { name: "停止并追加文字" });
  act(() => { handlers.onPartial("正在识别的临时文字"); });
  expect(append).not.toHaveBeenCalled(); expect(busy).toHaveBeenLastCalledWith(true);
  act(() => { handlers.onFinal("最终确认文字。"); });
  fireEvent.click(screen.getByRole("button", { name: "停止并追加文字" }));
  act(() => { handlers.onFinal("尾帧文字。"); handlers.onFinished(); });
  await waitFor(() => expect(append).toHaveBeenCalledTimes(1));
  expect(append).toHaveBeenCalledWith("最终确认文字 尾帧文字。");
  act(() => { handlers.onFinished(); });
  expect(append).toHaveBeenCalledTimes(1); expect(busy).toHaveBeenLastCalledWith(false);
});
it("cancel discards the recording without changing parent Markdown", async () => {
  const append = vi.fn();
  render(<InterviewVoiceInput sessionToken="voice-session" onAppend={append} />);
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await screen.findByRole("button", { name: "取消语音输入" });
  act(() => { handlers.onFinal("不要加入父文档。"); });
  fireEvent.click(screen.getByRole("button", { name: "取消语音输入" }));
  act(() => { handlers.onFinal("迟到文字。"); handlers.onFinished(); });
  expect(append).not.toHaveBeenCalled();
});
it("confirmed source disables microphone and an unconfigured provider reports its actual failure", async () => {
  const view = render(<InterviewVoiceInput sessionToken="voice-session" readOnly onAppend={vi.fn()} />);
  expect(screen.getByRole("button", { name: "语音输入" })).toBeDisabled();
  view.rerender(<InterviewVoiceInput sessionToken="voice-session" onAppend={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await screen.findByRole("button", { name: "停止并追加文字" });
  act(() => { handlers.onError("ASR_NOT_CONFIGURED"); });
  expect(screen.getByRole("alert")).toHaveTextContent("尚未配置语音转写服务");
});
it("intake prevents confirmation during capture and appends into its existing Markdown", async () => {
  const change = vi.fn(); const confirm = vi.fn();
  function Intake() {
    const [markdown, setMarkdown] = React.useState("# 已有研究需求");
    return <InterviewIntakeStep markdown={markdown} onChange={(value) => { change(value); setMarkdown(value); }} onConfirm={confirm} pending={false} voiceSessionToken="voice-session" />;
  }
  render(<Intake />);
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await screen.findByRole("button", { name: "停止并追加文字" });
  expect(screen.queryByRole("button", { name: "保存草稿" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "正在处理…" })).toBeDisabled();
  act(() => { handlers.onFinal("真实语音补充。"); });
  expect(screen.getByRole("textbox", { name: "研究需求 Markdown" })).toHaveValue("# 已有研究需求\n\n真实语音补充。");
  expect(screen.queryByLabelText("语音转录预览")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "停止并追加文字" }));
  act(() => { handlers.onFinished(); });
  await waitFor(() => expect(change).toHaveBeenCalledWith("# 已有研究需求\n\n真实语音补充。"));
  expect(screen.getByRole("textbox", { name: "研究需求 Markdown" })).toHaveValue("# 已有研究需求\n\n真实语音补充。");
  act(() => { handlers.onFinished(); });
  expect(change).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
});
it("shows interim speech only in the main editor and cancel restores the original demand", async () => {
  const change = vi.fn();
  render(<InterviewIntakeStep markdown="已有需求" onChange={change} onConfirm={vi.fn()} pending={false} voiceSessionToken="voice-session" />);
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await screen.findByRole("button", { name: "取消语音输入" });
  act(() => { handlers.onPartial("正在识别的临时内容"); });
  expect(screen.getByRole("textbox", { name: "研究需求 Markdown" })).toHaveValue("已有需求\n\n正在识别的临时内容");
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消语音输入" }));
  act(() => { handlers.onFinished(); });
  await waitFor(() => expect(screen.getByRole("textbox", { name: "研究需求 Markdown" })).toHaveValue("已有需求"));
  expect(change).not.toHaveBeenCalled();
});
it("provider error requires explicit review to append confirmed text and recovery cannot duplicate it", async () => {
  const append = vi.fn();
  render(<InterviewVoiceInput sessionToken="voice-session" onAppend={append} />);
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await screen.findByRole("button", { name: "停止并追加文字" });
  act(() => { handlers.onFinal("已确认内容。"); handlers.onPartial("不能保留的临时片段"); handlers.onError("ASR_PROVIDER_UNAVAILABLE"); });
  expect(append).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("语音转录预览")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "保留已确认转录" }));
  expect(append).toHaveBeenCalledWith("已确认内容。");
  expect(screen.queryByRole("button", { name: "保留已确认转录" })).not.toBeInTheDocument();
});
it("shows recoverable confirmed speech in the editor without persisting interim speech", async () => {
  const change = vi.fn();
  function Intake() {
    const [markdown, setMarkdown] = React.useState("已有需求");
    return <InterviewIntakeStep markdown={markdown} onChange={(value) => { change(value); setMarkdown(value); }} onConfirm={vi.fn()} pending={false} voiceSessionToken="voice-session" />;
  }
  render(<Intake />);
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await screen.findByRole("button", { name: "停止并追加文字" });
  act(() => { handlers.onFinal("已确认文字。"); handlers.onPartial("不应保留的临时文字"); handlers.onError("ASR_PROVIDER_UNAVAILABLE"); });
  const input = screen.getByRole("textbox", { name: "研究需求 Markdown" });
  expect(input).toHaveValue("已有需求\n\n已确认文字。");
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "正在处理…" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "保留已确认转录" }));
  await waitFor(() => expect(input).toHaveValue("已有需求\n\n已确认文字。"));
  expect(change).toHaveBeenCalledTimes(1);
});
it("keeps confirmed speech recoverable when the provider fails while stopping", async () => {
  const change = vi.fn();
  function Intake() {
    const [markdown, setMarkdown] = React.useState("已有需求");
    return <InterviewIntakeStep markdown={markdown} onChange={(value) => { change(value); setMarkdown(value); }} onConfirm={vi.fn()} pending={false} voiceSessionToken="voice-session" />;
  }
  render(<Intake />);
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await screen.findByRole("button", { name: "停止并追加文字" });
  act(() => { handlers.onFinal("收尾前已确认。"); });
  fireEvent.click(screen.getByRole("button", { name: "停止并追加文字" }));
  act(() => { handlers.onError("ASR_PROVIDER_UNAVAILABLE"); });
  expect(screen.getByRole("textbox", { name: "研究需求 Markdown" })).toHaveValue("已有需求\n\n收尾前已确认。");
  expect(screen.getByRole("button", { name: "保留已确认转录" })).toBeEnabled();
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "保留已确认转录" }));
  await waitFor(() => expect(change).toHaveBeenCalledWith("已有需求\n\n收尾前已确认。"));
});
it("a provider ending capture before the user clicks stop still offers confirmed text for explicit review", async () => {
  const append = vi.fn();
  render(<InterviewVoiceInput sessionToken="voice-session" onAppend={append} />);
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await screen.findByRole("button", { name: "停止并追加文字" });
  act(() => { handlers.onFinal("供应商结束前已确认文字。"); handlers.onFinished(); });
  expect(append).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "保留已确认转录" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "保留已确认转录" }));
  expect(append).toHaveBeenCalledWith("供应商结束前已确认文字。");
});
