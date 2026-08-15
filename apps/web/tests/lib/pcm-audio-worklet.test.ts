import { describe, expect, it } from "vitest";
import {
  PCM_AUDIO_WORKLET_SOURCE,
  PCM_FRAME_BYTES,
  PcmFrameBatcher,
  downsampleToPcm16Le,
} from "@/lib/PcmAudioWorklet";

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

  it("batches AudioWorklet microframes into 80ms PCM frames without reordering bytes", () => {
    const batcher = new PcmFrameBatcher(PCM_FRAME_BYTES);
    const source = Uint8Array.from({ length: PCM_FRAME_BYTES + 43 }, (_, index) => index % 251);
    const emitted: ArrayBuffer[] = [];

    for (let offset = 0; offset < source.byteLength; offset += 86) {
      emitted.push(...batcher.push(source.slice(offset, offset + 86).buffer));
    }

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.byteLength).toBe(PCM_FRAME_BYTES);
    expect(Array.from(new Uint8Array(emitted[0]!))).toEqual(Array.from(source.slice(0, PCM_FRAME_BYTES)));
  });

  it("flushes the exact remaining PCM tail when capture stops", () => {
    const batcher = new PcmFrameBatcher(8);

    expect(batcher.push(Uint8Array.from([1, 2, 3]).buffer)).toEqual([]);
    expect(
      batcher.push(Uint8Array.from([4, 5, 6, 7, 8, 9]).buffer)
        .map((frame) => Array.from(new Uint8Array(frame))),
    ).toEqual([
      [1, 2, 3, 4, 5, 6, 7, 8],
    ]);
    expect(Array.from(new Uint8Array(batcher.flush()!))).toEqual([9]);
    expect(batcher.flush()).toBeNull();
  });
});
