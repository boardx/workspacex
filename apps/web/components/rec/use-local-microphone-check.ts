"use client";
import * as React from "react";
import { startCapture, TARGET_SAMPLE_RATE, type CaptureHandle } from "@/lib/live-recording";
import { pcm16Level } from "@/lib/pcm-audio-level";

const MAX_SAMPLES = TARGET_SAMPLE_RATE * 8;
type State = "idle" | "requesting" | "recording" | "stopping" | "ready" | "empty" | "error";
type Attempt = {
  handle?: CaptureHandle;
  stopping?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  frames: Int16Array[];
  samples: number;
  ended: boolean;
};
function stop(attempt: Attempt): Promise<void> {
  if (attempt.timer) clearTimeout(attempt.timer);
  attempt.ended = true;
  if (!attempt.handle) return Promise.resolve();
  return attempt.stopping ??= attempt.handle.stop();
}

/** Small, bounded local WAV. Samples already use the shared target sample rate. */
export function pcmCheckWav(frames: readonly Int16Array[], samples: number): Blob {
  const buffer = new ArrayBuffer(44 + samples * 2);
  const data = new DataView(buffer);
  const word = (at: number, text: string) => { for (let i = 0; i < text.length; i++) data.setUint8(at + i, text.charCodeAt(i)); };
  word(0, "RIFF"); data.setUint32(4, 36 + samples * 2, true); word(8, "WAVE"); word(12, "fmt ");
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
  data.setUint32(24, TARGET_SAMPLE_RATE, true); data.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  data.setUint16(32, 2, true); data.setUint16(34, 16, true); word(36, "data"); data.setUint32(40, samples * 2, true);
  let offset = 44;
  for (const frame of frames) for (const sample of frame) { if (offset >= buffer.byteLength) break; data.setInt16(offset, sample, true); offset += 2; }
  return new Blob([buffer], { type: "audio/wav" });
}

/** No ASR client, network API or persistence: explicit capture → bounded memory → local URL. */
export function useLocalMicrophoneCheck(deviceId: string | null) {
  const [state, setState] = React.useState<State>("idle");
  const [level, setLevel] = React.useState(0);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const active = React.useRef<Attempt | null>(null);
  const url = React.useRef<string | null>(null);
  const discardUrl = React.useCallback(() => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  }, []);
  const dispose = React.useCallback(() => {
    const attempt = active.current;
    active.current = null;
    if (attempt) { attempt.frames = []; attempt.samples = 0; void stop(attempt).catch(() => undefined); }
    discardUrl();
  }, [discardUrl]);
  React.useEffect(() => {
    setState("idle"); setLevel(0); setError(null); setPreviewUrl(null);
    return dispose;
  }, [deviceId, dispose]);
  const clear = React.useCallback(async () => {
    dispose(); setState("idle"); setLevel(0); setPreviewUrl(null); setError(null);
  }, [dispose]);
  const finish = React.useCallback(async () => {
    const attempt = active.current;
    if (!attempt || attempt.ended) return;
    if (!attempt.handle) { await clear(); return; }
    setState("stopping"); setLevel(0);
    try {
      await stop(attempt);
      if (active.current !== attempt) return;
      active.current = null;
      if (!attempt.samples) { setState("empty"); return; }
      const blob = pcmCheckWav(attempt.frames, attempt.samples);
      attempt.frames = []; attempt.samples = 0;
      url.current = URL.createObjectURL(blob);
      setPreviewUrl(url.current); setState("ready");
    } catch {
      if (active.current === attempt) {
        active.current = null; attempt.frames = []; attempt.samples = 0;
        setError("capture-failed"); setState("error");
      }
    }
  }, [clear]);
  const start = React.useCallback(async () => {
    if (active.current) return;
    discardUrl(); setPreviewUrl(null); setError(null); setLevel(0); setState("requesting");
    const attempt: Attempt = { frames: [], samples: 0, ended: false };
    active.current = attempt;
    try {
      const handle = await startCapture(deviceId ? { deviceId } : {});
      attempt.handle = handle;
      if (active.current !== attempt || attempt.ended) { await stop(attempt); return; }
      setState("recording");
      handle.onFrame((frame) => {
        if (active.current !== attempt || attempt.ended) return;
        const kept = frame.slice(0, Math.max(0, MAX_SAMPLES - attempt.samples));
        if (kept.length) { attempt.frames.push(kept); attempt.samples += kept.length; setLevel(pcm16Level(kept)); }
        if (attempt.samples >= MAX_SAMPLES) void finish();
      });
      attempt.timer = setTimeout(() => { void finish(); }, 8000);
    } catch (cause) {
      if (active.current !== attempt) return;
      active.current = null;
      attempt.frames = []; attempt.samples = 0;
      setError(typeof cause === "object" && cause !== null && "kind" in cause ? String(cause.kind) : "capture-failed");
      setState("error");
    }
  }, [deviceId, discardUrl, finish]);
  return { state, level, previewUrl, error, start, finish, clear };
}
