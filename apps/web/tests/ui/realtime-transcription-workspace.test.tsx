import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RealtimeTranscriptionWorkspace } from "@/components/rec/realtime-transcription-workspace";

const SESSION = {
  sessionId: "session-1", name: "创建链路验证", tags: ["江西"], status: "idle" as const,
  durationMs: 0, createdAt: "2026-08-12T00:00:00Z", updatedAt: "2026-08-12T00:00:00Z",
  content: "第一句 第二句",
};

describe("RealtimeTranscriptionWorkspace", () => {
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
    expect(screen.getByTestId("rec-live-status")).toHaveTextContent("可续录");
    expect(screen.queryByText("已完成")).not.toBeInTheDocument();
    expect(screen.getByTestId("rec-live-toggle")).toHaveTextContent("继续转录");
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
});
