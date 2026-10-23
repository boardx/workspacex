import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RealtimeTranscriptionWorkspace } from "@/components/rec/realtime-transcription-workspace";

const SESSION = {
  sessionId: "session-1", name: "创建链路验证", tags: ["江西"], status: "idle" as const,
  durationMs: 0, createdAt: "2026-08-12T00:00:00Z", updatedAt: "2026-08-12T00:00:00Z",
  content: "第一句 第二句",
};

describe("RealtimeTranscriptionWorkspace", () => {
  it("explains durable transcript and unsaved editor states", () => {
    render(<RealtimeTranscriptionWorkspace session={SESSION} onBack={vi.fn()} onStart={vi.fn()} onStop={vi.fn()}
      onSaveContent={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByTestId("rec-live-reading-hint")).toHaveTextContent("已保存");
    fireEvent.click(screen.getByTestId("rec-live-edit"));
    expect(screen.getByTestId("rec-live-reading-hint")).toHaveTextContent("保存修改");
  });

  it("explains why editing is unavailable during capture", () => {
    render(<RealtimeTranscriptionWorkspace session={SESSION} streamState="recording" onBack={vi.fn()} onStart={vi.fn()} onStop={vi.fn()}
      onSaveContent={vi.fn()} />);
    expect(screen.getByTestId("rec-live-edit")).toBeDisabled();
    expect(screen.getByTestId("rec-live-reading-hint")).toHaveTextContent("完成收尾后可编辑");
  });

  it("blocks starting capture while editing and restores it after cancel", () => {
    const onStart = vi.fn();
    render(<RealtimeTranscriptionWorkspace session={SESSION} onBack={vi.fn()} onStart={onStart} onStop={vi.fn()} onSaveContent={vi.fn()} />);
    fireEvent.click(screen.getByTestId("rec-live-edit"));
    expect(screen.getByTestId("rec-live-toggle")).toBeDisabled();
    fireEvent.click(screen.getByTestId("rec-live-toggle"));
    expect(onStart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^取消$/ }));
    expect(screen.getByTestId("rec-live-toggle")).toBeEnabled();
  });
  it("keeps capture blocked through pending and failed saves", async () => {
    let rejectSave: (error: Error) => void = () => undefined;
    render(<RealtimeTranscriptionWorkspace session={SESSION} onBack={vi.fn()} onStart={vi.fn()} onStop={vi.fn()}
      onSaveContent={() => new Promise<void>((_, reject) => { rejectSave = reject; })} />);
    fireEvent.click(screen.getByTestId("rec-live-edit"));
    fireEvent.click(screen.getByTestId("rec-live-save"));
    expect(screen.getByTestId("rec-live-toggle")).toBeDisabled();
    rejectSave(new Error("save failed"));
    await vi.waitFor(() => expect(screen.getByTestId("rec-live-error")).toBeVisible());
    expect(screen.getByTestId("rec-live-toggle")).toBeDisabled();
    expect(screen.getByTestId("rec-live-editor")).toBeVisible();
  });

  it("does not claim an empty transcript is already saved and copyable", () => {
    render(<RealtimeTranscriptionWorkspace session={{ ...SESSION, content: "" }} onBack={vi.fn()} onStart={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByTestId("rec-live-copy")).toBeDisabled();
    expect(screen.getByTestId("rec-live-reading-hint")).toHaveTextContent("开始转录");
    expect(screen.getByTestId("rec-live-reading-hint")).not.toHaveTextContent("已保存");
  });

  it.each(["idle", "error"] as const)("allows leaving stale server recording state when the local stream is %s", (streamState) => {
    const onBack = vi.fn();
    render(<RealtimeTranscriptionWorkspace session={{ ...SESSION, status: "recording" }} streamState={streamState}
      reconnecting={false} onBack={onBack} onStart={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByTestId("rec-live-back")).toBeEnabled();
    fireEvent.click(screen.getByTestId("rec-live-back"));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("keeps an unsaved transcript in place until editing is saved or canceled", () => {
    const onBack = vi.fn();
    render(<RealtimeTranscriptionWorkspace session={SESSION} onBack={onBack} onStart={vi.fn()} onStop={vi.fn()}
      onSaveContent={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(screen.getByTestId("rec-live-edit"));
    fireEvent.change(screen.getByRole("textbox", { name: "逐字稿正文" }), { target: { value: "尚未保存的草稿" } });
    expect(screen.getByTestId("rec-live-back")).toBeDisabled();
    expect(screen.getByTestId("rec-live-back")).toHaveAccessibleDescription(/保存或取消/);
    fireEvent.click(screen.getByTestId("rec-live-back"));
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "逐字稿正文" })).toHaveValue("尚未保存的草稿");
    fireEvent.click(screen.getByRole("button", { name: /^取消$/ }));
    expect(screen.getByTestId("rec-live-back")).toBeEnabled();
  });

  it("prevents leaving during a pending save and enables return after it settles", async () => {
    let finishSave: () => void = () => undefined;
    const onSaveContent = vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    const onBack = vi.fn();
    render(<RealtimeTranscriptionWorkspace session={SESSION} onBack={onBack} onStart={vi.fn()} onStop={vi.fn()}
      onSaveContent={onSaveContent} />);
    fireEvent.click(screen.getByTestId("rec-live-edit"));
    fireEvent.click(screen.getByTestId("rec-live-save"));
    expect(screen.getByTestId("rec-live-back")).toBeDisabled();
    expect(screen.getByTestId("rec-live-back")).toHaveAccessibleDescription(/保存/);
    finishSave();
    await vi.waitFor(() => expect(screen.getByTestId("rec-live-back")).toBeEnabled());
    fireEvent.click(screen.getByTestId("rec-live-back"));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("reports clipboard denial and allows a successful retry", async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<RealtimeTranscriptionWorkspace session={SESSION} onBack={vi.fn()} onStart={vi.fn()} onStop={vi.fn()} />);
    fireEvent.click(screen.getByTestId("rec-live-copy"));
    expect(await screen.findByRole("alert")).toHaveTextContent("复制失败");
    expect(screen.queryByText("已复制")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("rec-live-copy"));
    await vi.waitFor(() => expect(screen.getByTestId("rec-live-copy")).toHaveTextContent("已复制"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(writeText).toHaveBeenLastCalledWith(SESSION.content);
  });

  it.each(["recording", "stopping"] as const)("explains unavailable return during %s", (streamState) => {
    const onBack = vi.fn();
    render(<RealtimeTranscriptionWorkspace session={SESSION} streamState={streamState} onBack={onBack} onStart={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByTestId("rec-live-back")).toBeDisabled();
    expect(screen.getByTestId("rec-live-back")).toHaveAccessibleDescription(/返回历史/);
    fireEvent.click(screen.getByTestId("rec-live-back"));
    expect(onBack).not.toHaveBeenCalled();
  });

  it("requires stopping before renaming because metadata cannot change during a capture", () => {
    const onRename = vi.fn();
    render(<RealtimeTranscriptionWorkspace session={{ ...SESSION, status: "recording" }} streamState="recording"
      onRename={onRename} onBack={vi.fn()} onStart={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByRole("button", { name: "修改录音名称" })).toBeDisabled();
    fireEvent.doubleClick(screen.getByTestId("rec-live-title"));
    expect(screen.queryByRole("textbox", { name: "录音名称" })).not.toBeInTheDocument();
  });

  it("uses the audio meter without a duplicate normal-recording indicator", () => {
    render(<RealtimeTranscriptionWorkspace session={SESSION} streamState="recording" inputLevel={0.6}
      onBack={vi.fn()} onStart={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByRole("meter", { name: "麦克风输入音量" })).toHaveAttribute("aria-valuenow", "60");
    expect(screen.queryByText("正在接收音频")).not.toBeInTheDocument();
    expect(screen.getByTestId("rec-live-toggle")).toHaveTextContent("停止转录");
  });

  it("renames by double click or keyboard, retains failed input, and cancels with Escape", async () => {
    const onRename = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    render(<RealtimeTranscriptionWorkspace session={SESSION} onRename={onRename}
      onBack={vi.fn()} onStart={vi.fn()} onStop={vi.fn()} />);
    fireEvent.doubleClick(screen.getByTestId("rec-live-title"));
    const input = screen.getByRole("textbox", { name: "录音名称" });
    fireEvent.change(input, { target: { value: "新录音名称" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("名称保存失败"));
    expect(input).toHaveValue("新录音名称");
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(screen.queryByRole("textbox", { name: "录音名称" })).not.toBeInTheDocument());
    expect(onRename).toHaveBeenNthCalledWith(2, "新录音名称");
    fireEvent.keyDown(screen.getByRole("button", { name: "修改录音名称" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "录音名称" }), { key: "Escape" });
    expect(onRename).toHaveBeenCalledTimes(2);
  });

  it("returns keyboard focus to the title after canceling or saving a rename", async () => {
    render(<RealtimeTranscriptionWorkspace session={SESSION} onRename={vi.fn().mockResolvedValue(undefined)}
      onBack={vi.fn()} onStart={vi.fn()} onStop={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "修改录音名称" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "录音名称" }), { key: "Escape" });
    expect(screen.getByRole("button", { name: "修改录音名称" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: "修改录音名称" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "录音名称" }), { key: "Enter" });
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "修改录音名称" })).toHaveFocus());
  });

  it("allows canceling the initial connection", () => {
    const onStop = vi.fn();
    render(<RealtimeTranscriptionWorkspace session={SESSION} onBack={vi.fn()} streamState="connecting"
      onStart={vi.fn()} onStop={onStop} />);
    expect(screen.getByTestId("rec-live-toggle")).toBeEnabled();
    expect(screen.getByTestId("rec-live-toggle")).not.toHaveAttribute("aria-busy", "true");
    fireEvent.click(screen.getByTestId("rec-live-toggle"));
    expect(onStop).toHaveBeenCalledOnce();
  });
  it("marks only real stop settlement as busy and blocks duplicate stop", () => {
    const onStop = vi.fn();
    render(<RealtimeTranscriptionWorkspace session={SESSION} streamState="stopping"
      onBack={vi.fn()} onStart={vi.fn()} onStop={onStop} />);
    const stop = screen.getByTestId("rec-live-toggle");
    expect(stop).toBeDisabled();
    expect(stop).toHaveAttribute("aria-busy", "true");
    fireEvent.click(stop);
    expect(onStop).not.toHaveBeenCalled();
  });

  it("focuses the named editor on entry and restores the edit action after saving", async () => {
    render(<RealtimeTranscriptionWorkspace session={SESSION} onBack={vi.fn()}
      onStart={vi.fn()} onStop={vi.fn()} onSaveContent={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(screen.getByTestId("rec-live-edit"));
    expect(screen.getByRole("textbox", { name: "逐字稿正文" })).toHaveFocus();
    fireEvent.change(screen.getByRole("textbox", { name: "逐字稿正文" }), { target: { value: "修改正文" } });
    fireEvent.click(screen.getByTestId("rec-live-save"));
    await vi.waitFor(() => expect(screen.getByTestId("rec-live-edit")).toHaveFocus());
  });

  it("keeps failed save drafts editable and retries without an unhandled rejection", async () => {
    const onSaveContent = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    render(<RealtimeTranscriptionWorkspace session={SESSION} onBack={vi.fn()}
      onStart={vi.fn()} onStop={vi.fn()} onSaveContent={onSaveContent} />);
    fireEvent.click(screen.getByTestId("rec-live-edit"));
    fireEvent.change(screen.getByRole("textbox", { name: "逐字稿正文" }), { target: { value: "失败后保留草稿" } });
    fireEvent.click(screen.getByTestId("rec-live-save"));
    await vi.waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("正文保存失败"));
    expect(screen.getByRole("textbox", { name: "逐字稿正文" })).toHaveValue("失败后保留草稿");
    fireEvent.click(screen.getByTestId("rec-live-save"));
    await vi.waitFor(() => expect(screen.getByTestId("rec-live-edit")).toHaveFocus());
    expect(onSaveContent).toHaveBeenNthCalledWith(2, "失败后保留草稿");
  });

  it("clears the local save error when failed editing is canceled", async () => {
    render(<RealtimeTranscriptionWorkspace session={SESSION} onBack={vi.fn()}
      onStart={vi.fn()} onStop={vi.fn()} onSaveContent={vi.fn().mockRejectedValue(new Error("offline"))} />);
    fireEvent.click(screen.getByTestId("rec-live-edit"));
    fireEvent.click(screen.getByTestId("rec-live-save"));
    await vi.waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("正文保存失败"));
    fireEvent.click(screen.getByRole("button", { name: /^取消$/ }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("rec-live-edit")).toHaveFocus();
  });

  it("restores editor focus after transcription makes the edit action usable again", () => {
    const props = { session: SESSION, onBack: vi.fn(), onStart: vi.fn(), onStop: vi.fn(), onSaveContent: vi.fn() };
    const view = render(<RealtimeTranscriptionWorkspace {...props} streamState="idle" />);
    fireEvent.click(screen.getByTestId("rec-live-edit"));
    view.rerender(<RealtimeTranscriptionWorkspace {...props} streamState="recording" />);
    fireEvent.click(screen.getByRole("button", { name: /^取消$/ }));
    expect(screen.getByTestId("rec-live-edit")).toBeDisabled();
    view.rerender(<RealtimeTranscriptionWorkspace {...props} streamState="idle" />);
    expect(screen.getByTestId("rec-live-edit")).toHaveFocus();
  });

  it("does not restore delayed edit focus after the user focuses another control", () => {
    const props = { session: SESSION, onBack: vi.fn(), onStart: vi.fn(), onStop: vi.fn(), onSaveContent: vi.fn() };
    const view = render(<RealtimeTranscriptionWorkspace {...props} streamState="idle" />);
    fireEvent.click(screen.getByTestId("rec-live-edit"));
    view.rerender(<RealtimeTranscriptionWorkspace {...props} streamState="recording" />);
    fireEvent.click(screen.getByRole("button", { name: /^取消$/ }));
    screen.getByTestId("rec-live-toggle").focus();
    view.rerender(<RealtimeTranscriptionWorkspace {...props} streamState="idle" />);
    expect(screen.getByTestId("rec-live-toggle")).toHaveFocus();
  });

  it("discards delayed edit focus when the recording session changes", () => {
    const props = { session: SESSION, onBack: vi.fn(), onStart: vi.fn(), onStop: vi.fn(), onSaveContent: vi.fn() };
    const view = render(<RealtimeTranscriptionWorkspace {...props} streamState="idle" />);
    fireEvent.click(screen.getByTestId("rec-live-edit"));
    view.rerender(<RealtimeTranscriptionWorkspace {...props} streamState="recording" />);
    fireEvent.click(screen.getByRole("button", { name: /^取消$/ }));
    view.rerender(<RealtimeTranscriptionWorkspace {...props} session={{ ...SESSION, sessionId: "another-session" }} streamState="idle" />);
    expect(screen.getByTestId("rec-live-edit")).not.toHaveFocus();
  });

  it("keeps save pending and prevents duplicate submission through shared actions", async () => {
    let resolveSave!: () => void;
    const onSaveContent = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    render(<RealtimeTranscriptionWorkspace session={SESSION} onBack={vi.fn()}
      onStart={vi.fn()} onStop={vi.fn()} onSaveContent={onSaveContent} />);
    fireEvent.click(screen.getByTestId("rec-live-edit"));
    fireEvent.change(screen.getByTestId("rec-live-editor"), { target: { value: "修订正文" } });
    fireEvent.click(screen.getByTestId("rec-live-save"));
    const save = screen.getByTestId("rec-live-save");
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    fireEvent.click(save);
    expect(onSaveContent).toHaveBeenCalledTimes(1);
    expect(onSaveContent).toHaveBeenCalledWith("修订正文");
    resolveSave();
    await vi.waitFor(() => expect(screen.queryByTestId("rec-live-editor")).not.toBeInTheDocument());
  });

  it("enables the only start button and invokes the real start action", () => {
    const onStart = vi.fn();
    render(<RealtimeTranscriptionWorkspace session={SESSION} onBack={vi.fn()} streamState="idle" onStart={onStart} onStop={vi.fn()} />);
    const button = screen.getByTestId("rec-live-toggle");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("treats a stopped transcription as resumable instead of completed", () => {
    render(<RealtimeTranscriptionWorkspace session={SESSION} onBack={vi.fn()} streamState="idle"
      onStart={vi.fn()} onStop={vi.fn()} />);
    expect(screen.queryByTestId("rec-live-status")).not.toBeInTheDocument();
    expect(screen.queryByText("已完成")).not.toBeInTheDocument();
    expect(screen.getByTestId("rec-live-toggle")).toHaveTextContent("继续转录");
    expect(screen.queryByTestId("rec-live-transient-notice")).not.toBeInTheDocument();
    expect(screen.queryByText("最终识别会持续追加并保存为一段正文，停止后可以修改。")).not.toBeInTheDocument();
  });

  it("renders one body without segment timestamps and copies the whole body", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<RealtimeTranscriptionWorkspace session={SESSION} onBack={vi.fn()} streamState="idle"
      onStart={vi.fn()} onStop={vi.fn()} onSaveContent={vi.fn()} />);
    expect(screen.getByTestId("rec-live-content")).toHaveTextContent("第一句 第二句");
    expect(screen.queryByText("最终")).not.toBeInTheDocument();
    expect(screen.queryByText("00:01")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("rec-live-copy"));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("第一句 第二句"));
  });

  it("edits and saves the complete body only while recording is stopped", async () => {
    const onSaveContent = vi.fn().mockResolvedValue(undefined);
    render(<RealtimeTranscriptionWorkspace session={SESSION} onBack={vi.fn()} streamState="idle"
      onStart={vi.fn()} onStop={vi.fn()} onSaveContent={onSaveContent} />);
    fireEvent.click(screen.getByTestId("rec-live-edit"));
    fireEvent.change(screen.getByTestId("rec-live-editor"), { target: { value: "人工修订全文" } });
    fireEvent.click(screen.getByTestId("rec-live-save"));
    await vi.waitFor(() => expect(onSaveContent).toHaveBeenCalledWith("人工修订全文"));
  });

  it("renders interim separately and disables repeated stop while tail results are finishing", () => {
    render(<RealtimeTranscriptionWorkspace session={{ ...SESSION, status: "recording" }} onBack={vi.fn()}
      streamState="stopping" interimSegment="尚未最终确认" onStart={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByTestId("rec-live-interim")).toHaveTextContent("尚未最终确认");
    expect(screen.getByTestId("rec-live-toggle")).toHaveTextContent("正在收尾");
    expect(screen.getByTestId("rec-live-toggle")).toBeDisabled();
    expect(screen.getByTestId("rec-live-edit")).toBeDisabled();
  });

  it("distinguishes an interim confirmation from recoverable slow delivery", () => {
    render(<RealtimeTranscriptionWorkspace session={{ ...SESSION, status: "recording" }} onBack={vi.fn()}
      streamState="recording" flowState="slow" interimSegment="实时草稿" onStart={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByTestId("rec-live-interim")).toHaveTextContent(/^实时草稿$/);
    expect(screen.getByText("音频仍在传输或确认中")).toBeVisible();
    expect(screen.getByTestId("rec-live-toggle")).toBeEnabled();
  });

  it("does not show a stale slow advisory after capture is idle", () => {
    render(<RealtimeTranscriptionWorkspace session={SESSION} onBack={vi.fn()}
      streamState="idle" flowState="slow" onStart={vi.fn()} onStop={vi.fn()} />);
    expect(screen.queryByText("音频仍在传输或确认中")).not.toBeInTheDocument();
  });

  it("opens a recoverable error dialog and reconnects without hiding durable text", () => {
    const onReconnect = vi.fn();
    render(<RealtimeTranscriptionWorkspace session={SESSION} onBack={vi.fn()} streamState="error"
      errorMessage="无法启动实时转录，请稍后重试。" reconnectableError onReconnect={onReconnect} onStart={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByTestId("rec-live-reconnect-dialog")).toBeVisible();
    expect(screen.getByTestId("rec-live-content")).toHaveTextContent("第一句 第二句");
    fireEvent.click(screen.getByTestId("rec-live-reconnect"));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("keeps post-stop refresh errors as an inline alert without offering reconnect", () => {
    render(<RealtimeTranscriptionWorkspace session={SESSION} onBack={vi.fn()} streamState="idle"
      errorMessage="转录已停止，已保存文字仍保留；暂时无法刷新最新正文，请稍后重新打开。" onStart={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByTestId("rec-live-error")).toBeVisible();
    expect(screen.queryByTestId("rec-live-reconnect-dialog")).not.toBeInTheDocument();
  });

  it("shows the selected microphone and real input level, and locks selection while recording", () => {
    const onSelectDevice = vi.fn();
    const { rerender } = render(<RealtimeTranscriptionWorkspace session={SESSION} onBack={vi.fn()}
      streamState="idle" inputLevel={0} devices={[{ deviceId: "mic-1", label: "会议室麦克风" }]}
      selectedDeviceId="mic-1" onSelectDevice={onSelectDevice} onStart={vi.fn()} onStop={vi.fn()} />);

    expect(screen.getByTestId("rec-mic-device-select")).toHaveAttribute("title", "麦克风：会议室麦克风");
    expect(screen.getByTestId("rec-mic-device-select")).not.toHaveTextContent("会议室麦克风");
    expect(screen.getByTestId("rec-live-toggle").parentElement).toHaveClass("flex-wrap");
    expect(screen.getByTestId("rec-live-input-level")).toHaveAttribute("aria-valuenow", "0");
    fireEvent.click(screen.getByTestId("rec-mic-device-select"));
    expect(screen.getByTestId("rec-mic-device-listbox")).toHaveClass("top-8");
    fireEvent.click(screen.getByTestId("rec-mic-device-option-default"));
    expect(onSelectDevice).toHaveBeenCalledWith(null);

    rerender(<RealtimeTranscriptionWorkspace session={{ ...SESSION, status: "recording" }} onBack={vi.fn()}
      streamState="recording" inputLevel={0.65} devices={[{ deviceId: "mic-1", label: "会议室麦克风" }]}
      selectedDeviceId="mic-1" onSelectDevice={onSelectDevice} onStart={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByTestId("rec-mic-device-select")).toBeDisabled();
    expect(screen.getByTestId("rec-live-input-level")).toHaveAttribute("aria-valuenow", "65");
  });
});
