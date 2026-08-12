import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RealtimeTranscriptionWorkspace } from "@/components/rec/realtime-transcription-workspace";

const SESSION = {
  sessionId: "session-1", name: "创建链路验证", tags: ["江西"], status: "idle" as const,
  durationMs: 0, createdAt: "2026-08-12T00:00:00Z", updatedAt: "2026-08-12T00:00:00Z", captures: [],
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

  it("renders interim separately and disables repeated stop while tail results are finishing", () => {
    render(<RealtimeTranscriptionWorkspace session={{ ...SESSION, status: "recording" }} onBack={vi.fn()}
      streamState="stopping" interimSegment="尚未最终确认" onStart={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByTestId("rec-live-interim")).toHaveTextContent("尚未最终确认");
    expect(screen.getByTestId("rec-live-toggle")).toHaveTextContent("正在收尾");
    expect(screen.getByTestId("rec-live-toggle")).toBeDisabled();
  });
});
