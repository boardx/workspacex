import { describe, expect, it } from "vitest";
import { browserAudioFlowState, pcm16MonoQueuedMs } from "@/lib/realtime-asr-flow";

describe("realtime ASR browser flow", () => {
  it("uses PCM duration and hysteresis for recoverable browser backlog", () => {
    expect(pcm16MonoQueuedMs(12_800)).toBe(400);
    expect(browserAudioFlowState("normal", 12_800)).toEqual({ state: "slow", queuedMs: 400 });
    expect(browserAudioFlowState("slow", 6_400)).toEqual({ state: "normal", queuedMs: 200 });
    expect(browserAudioFlowState("slow", 9_000)).toEqual({ state: "slow", queuedMs: 281 });
  });
});
