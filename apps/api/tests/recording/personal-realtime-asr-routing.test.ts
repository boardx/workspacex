import { describe, expect, it } from "vitest";
import { isPersonalRealtimeAsrUpgrade } from "../../src/interface/ws/asr-stream.gateway";
import { matchPersonalRealtimeAsrPath } from "../../src/interface/ws/personal-realtime-asr.gateway";

describe("personal realtime ASR routing", () => {
  it("reserves the deployed recording alias for one-time personal tickets", () => {
    const url = new URL(
      "/recording/sessions/transcription-1/asr-stream?captureId=capture-1&ticket=secret",
      "http://localhost",
    );

    expect(isPersonalRealtimeAsrUpgrade(url)).toBe(true);
    expect(matchPersonalRealtimeAsrPath(url)).toEqual({
      transcriptionId: "transcription-1",
      captureId: "capture-1",
    });
  });

  it("keeps the canonical personal stream path compatible", () => {
    const url = new URL(
      "/recording/realtime-asr/sessions/transcription-1/captures/capture-1/stream?ticket=secret",
      "http://localhost",
    );

    expect(matchPersonalRealtimeAsrPath(url)).toEqual({
      transcriptionId: "transcription-1",
      captureId: "capture-1",
    });
  });

  it("does not divert legacy recording streams without a personal capture", () => {
    const url = new URL("/recording/sessions/session-1/asr-stream", "http://localhost");
    expect(isPersonalRealtimeAsrUpgrade(url)).toBe(false);
  });
});
