import { describe, expect, it } from "vitest";
import { pcm16MonoDurationMs, pcm16MonoDurationSeconds } from "../../src/interface/ws/personal-realtime-asr.gateway";

describe("personal realtime ASR: duration written to recording_sessions.duration_ms (bigint)", () => {
  it("is always an integer, even when the PCM byte count is not a multiple of 32", () => {
    for (const bytes of [0, 1, 1234, 64_512, 97_281, 3_200_017]) {
      expect(Number.isInteger(pcm16MonoDurationMs(bytes))).toBe(true);
    }
  });

  it("rounds to the nearest millisecond and agrees with the seconds helper", () => {
    expect(pcm16MonoDurationMs(32_000)).toBe(1000);
    expect(pcm16MonoDurationMs(1234)).toBe(Math.round(pcm16MonoDurationSeconds(1234) * 1000));
    expect(pcm16MonoDurationMs(1234)).toBe(39);
  });
});
