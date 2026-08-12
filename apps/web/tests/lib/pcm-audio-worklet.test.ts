import { describe, expect, it } from "vitest";
import { PCM_AUDIO_WORKLET_SOURCE, downsampleToPcm16Le } from "@/lib/PcmAudioWorklet";

describe("PcmAudioWorklet", () => {
  it("declares an AudioWorklet processor instead of the deprecated ScriptProcessor path", () => {
    expect(PCM_AUDIO_WORKLET_SOURCE).toContain("registerProcessor");
    expect(PCM_AUDIO_WORKLET_SOURCE).toContain("boardx-pcm16-processor");
    expect(PCM_AUDIO_WORKLET_SOURCE).not.toContain("createScriptProcessor");
  });

  it("downmixes channels and produces 16kHz signed PCM16 little-endian bytes", () => {
    const left = Float32Array.from([1, 0.5, 0, -1, -0.5, 0]);
    const right = Float32Array.from([1, 0.5, 0, -1, -0.5, 0]);
    const bytes = downsampleToPcm16Le([left, right], 48_000, 16_000);
    expect(bytes).toBeInstanceOf(ArrayBuffer);
    const view = new DataView(bytes);
    expect(view.byteLength).toBe(4);
    expect(view.getInt16(0, true)).toBe(32_767);
    expect(view.getInt16(2, true)).toBe(-32_768);
  });
});
