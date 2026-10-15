import { afterEach, expect, it, vi } from "vitest";
import { startPcmAudioWorklet } from "@/lib/PcmAudioWorklet";

afterEach(() => vi.unstubAllGlobals());

it("flushes the tail and releases tracks even when AudioContext.close rejects", async () => {
  const stopTrack = vi.fn();
  const disconnect = vi.fn();
  const close = vi.fn().mockRejectedValue(new DOMException("Already closing", "InvalidStateError"));
  const port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: () => void } = {
    onmessage: null,
    postMessage: () => {
      queueMicrotask(() => {
        port.onmessage?.({ data: new ArrayBuffer(4) });
        port.onmessage?.({ data: { type: "flushed" } });
      });
    },
  };
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => ({
    getAudioTracks: () => [{}], getTracks: () => [{ stop: stopTrack }],
  }) } });
  vi.stubGlobal("AudioContext", class {
    sampleRate = 48000; state = "running"; destination = {};
    audioWorklet = { addModule: async () => undefined };
    createMediaStreamSource() { return { connect: vi.fn(), disconnect }; }
    createGain() { return { gain: { value: 0 }, connect: vi.fn(), disconnect }; }
    close = close;
  });
  vi.stubGlobal("AudioWorkletNode", class {
    port = port; connect = vi.fn(); disconnect = disconnect;
  });
  const BaseURL = URL;
  vi.stubGlobal("URL", class extends BaseURL {
    static createObjectURL() { return "blob:test-worklet"; }
    static revokeObjectURL() {}
  });
  const handle = await startPcmAudioWorklet();
  const frame = vi.fn();
  handle.onFrame(frame);
  await expect(handle.stop()).resolves.toBeUndefined();
  expect(frame).toHaveBeenCalledOnce();
  expect(stopTrack).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});
