/**
 * #802 hotfix -- `ConfiguredRealtimeAsrProvider`'s wire protocol against a REAL dashscope
 * shape, not the loopback's own (previously wrong) assumptions.
 *
 * Before this file existed, the only coverage of this provider's actual upstream protocol
 * was `loopback-asr-provider.ts` (used by the fullstack e2e smoke) -- and that loopback was
 * written by the SAME person with the SAME wrong assumptions as the adapter it stood in
 * for, so the smoke test stayed green while the real `wss://dashscope.aliyuncs.com/…`
 * endpoint rejected the exact frames being sent (verified directly against the real
 * endpoint on devapp with the real `KERNEL_ASR_API_KEY`, see issue #802's own body -- no
 * key or its value appears in this repo). This file's fake upstream mirrors the REAL
 * protocol shape (query-param model selection, `session.update`, `input_audio_format:
 * "pcm"`, top-level `sample_rate`) so a regression back to the wrong shape fails a test
 * that runs on every push, not just a manual devapp probe.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";
import { ConfiguredRealtimeAsrProvider } from "../../src/infrastructure/recording/configured-realtime-asr-provider";
import type { AsrAudioFormat, AsrSessionHandlers } from "../../src/application/recording/asr-ports";

const AUDIO: AsrAudioFormat = { sampleRate: 16_000, channels: 1, encoding: "pcm16le" };
const MODEL = "qwen3-asr-flash-realtime";

/** Records handler calls so assertions can inspect them without racing promises. */
function recordingHandlers(): AsrSessionHandlers & {
  readonly partials: string[];
  readonly finals: string[];
  readonly errors: { reason: string; detail: string }[];
  readonly closedCount: { value: number };
} {
  const partials: string[] = [];
  const finals: string[] = [];
  const errors: { reason: string; detail: string }[] = [];
  const closedCount = { value: 0 };
  return {
    partials, finals, errors, closedCount,
    onPartial: (t) => partials.push(t.text),
    onFinal: (t) => finals.push(t.text),
    onError: (reason, detail) => errors.push({ reason, detail }),
    onClosed: () => { closedCount.value += 1; },
  };
}

interface FakeUpstream {
  readonly port: number;
  readonly seenUrl: { value: string };
  readonly seenFrames: { type?: string; session?: unknown }[];
  close: () => Promise<void>;
}

/** Behaviour is parameterized so each test can drive a different real-protocol scenario. */
async function startFakeUpstream(
  onFrame: (frame: { type?: string; session?: unknown }, ws: WsWebSocket) => void,
): Promise<FakeUpstream> {
  const server: Server = createServer();
  const wss = new WebSocketServer({ server });
  const seenUrl = { value: "" };
  const seenFrames: { type?: string; session?: unknown }[] = [];
  wss.on("connection", (ws, req) => {
    seenUrl.value = req.url ?? "";
    ws.on("message", (raw: Buffer) => {
      const frame = JSON.parse(String(raw)) as { type?: string; session?: unknown };
      seenFrames.push(frame);
      onFrame(frame, ws);
    });
  });
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
  return {
    port, seenUrl, seenFrames,
    close: () => new Promise<void>((resolve) => { wss.close(); server.close(() => resolve()); }),
  };
}

let upstream: FakeUpstream | null = null;

afterEach(async () => {
  if (upstream) await upstream.close();
  upstream = null;
});

describe("ConfiguredRealtimeAsrProvider -- real dashscope realtime protocol shape", () => {
  it("passes the model as a `?model=` query param on the connection URL, not only via a post-connect message", async () => {
    upstream = await startFakeUpstream(() => {});
    const provider = new ConfiguredRealtimeAsrProvider({
      provider: "dashscope", baseUrl: `ws://127.0.0.1:${upstream.port}`, apiKey: "k", model: MODEL,
    });
    const handlers = recordingHandlers();
    const session = await provider.open(handlers, AUDIO);
    await new Promise((r) => setTimeout(r, 20));
    expect(upstream.seenUrl.value).toBe(`/?model=${MODEL}`);
    session.abort();
  });

  it("sends `session.update` (not `transcription_session.update`) with `input_audio_format: \"pcm\"` and a top-level `sample_rate`", async () => {
    upstream = await startFakeUpstream(() => {});
    const provider = new ConfiguredRealtimeAsrProvider({
      provider: "dashscope", baseUrl: `ws://127.0.0.1:${upstream.port}`, apiKey: "k", model: MODEL,
    });
    const handlers = recordingHandlers();
    const session = await provider.open(handlers, AUDIO);
    await new Promise((r) => setTimeout(r, 20));
    const update = upstream.seenFrames.find((f) => f.type === "session.update");
    expect(update).toBeDefined();
    expect(update?.session).toMatchObject({ input_audio_format: "pcm", sample_rate: AUDIO.sampleRate });
    // The wrong field names/values this hotfix removed must never reappear.
    expect(JSON.stringify(update?.session)).not.toContain("input_audio_sample_rate");
    expect(JSON.stringify(update?.session)).not.toContain("pcm16le");
    session.abort();
  });

  // PROP-CHAT-ASR-LATENCY-001 —— turn_detection 是待真实端点验证的实验开关：
  // 默认必须与之前逐字节相同（连字段都不出现），设了才多发这一个字段。
  it("does NOT send `turn_detection` at all when turnDetectionSilenceMs is unset (byte-compat default)", async () => {
    upstream = await startFakeUpstream(() => {});
    const provider = new ConfiguredRealtimeAsrProvider({
      provider: "dashscope", baseUrl: `ws://127.0.0.1:${upstream.port}`, apiKey: "k", model: MODEL,
    });
    const session = await provider.open(recordingHandlers(), AUDIO);
    await new Promise((r) => setTimeout(r, 20));
    const update = upstream.seenFrames.find((f) => f.type === "session.update");
    expect(JSON.stringify(update?.session)).not.toContain("turn_detection");
    session.abort();
  });

  it("sends `turn_detection.silence_duration_ms` only when turnDetectionSilenceMs is explicitly set", async () => {
    upstream = await startFakeUpstream(() => {});
    const provider = new ConfiguredRealtimeAsrProvider({
      provider: "dashscope", baseUrl: `ws://127.0.0.1:${upstream.port}`, apiKey: "k", model: MODEL,
      turnDetectionSilenceMs: 300,
    });
    const session = await provider.open(recordingHandlers(), AUDIO);
    await new Promise((r) => setTimeout(r, 20));
    const update = upstream.seenFrames.find((f) => f.type === "session.update");
    expect(update?.session).toMatchObject({
      turn_detection: { type: "server_vad", silence_duration_ms: 300 },
    });
    session.abort();
  });

  it("forwards real partial/final transcripts once the upstream sends them", async () => {
    upstream = await startFakeUpstream((frame, ws) => {
      if (frame.type === "session.update") ws.send(JSON.stringify({ type: "session.updated" }));
      if (frame.type === "input_audio_buffer.commit") {
        ws.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.delta", delta: "你" }));
        ws.send(JSON.stringify({
          type: "conversation.item.input_audio_transcription.completed", transcript: "你好", confidence: 0.9,
        }));
      }
    });
    const provider = new ConfiguredRealtimeAsrProvider({
      provider: "dashscope", baseUrl: `ws://127.0.0.1:${upstream.port}`, apiKey: "k", model: MODEL,
    });
    const handlers = recordingHandlers();
    const session = await provider.open(handlers, AUDIO);
    session.commit();
    await new Promise((r) => setTimeout(r, 30));
    expect(handlers.partials).toEqual(["你"]);
    expect(handlers.finals).toEqual(["你好"]);
    session.abort();
  });

  it("#802 -- an unexpected upstream close (never caller-initiated via finish()/abort()) is reported as a real error, not silently treated as a clean finish", async () => {
    upstream = await startFakeUpstream((frame, ws) => {
      // Simulate exactly what the real bug looked like: upstream accepts the connection,
      // then rejects it almost immediately (e.g. a rejected default model) WITHOUT ever
      // sending an `error` frame first -- a raw close, same as the real dashscope 1007.
      if (frame.type === "session.update") ws.close(1007, "Model not found");
    });
    const provider = new ConfiguredRealtimeAsrProvider({
      provider: "dashscope", baseUrl: `ws://127.0.0.1:${upstream.port}`, apiKey: "k", model: MODEL,
    });
    const handlers = recordingHandlers();
    await provider.open(handlers, AUDIO);
    await new Promise((r) => setTimeout(r, 30));
    // This is the exact assertion that would have caught #802 before it ever reached
    // production: a run that transcribed nothing must not look identical to a clean finish.
    expect(handlers.errors).toHaveLength(1);
    expect(handlers.errors[0]?.reason).toBe("ASR_PROVIDER_UNAVAILABLE");
    expect(handlers.errors[0]?.detail).toContain("unexpectedly");
    expect(handlers.closedCount.value).toBe(1);
  });

  it("finishes a VAD session with session.finish and waits for session.finished", async () => {
    upstream = await startFakeUpstream((frame, ws) => {
      if (frame.type === "session.update") ws.send(JSON.stringify({ type: "session.updated" }));
      if (frame.type === "session.finish") ws.send(JSON.stringify({ type: "session.finished" }));
    });
    const provider = new ConfiguredRealtimeAsrProvider({
      provider: "dashscope", baseUrl: `ws://127.0.0.1:${upstream.port}`, apiKey: "k", model: MODEL,
    });
    const handlers = recordingHandlers();
    const session = await provider.open(handlers, AUDIO);
    try {
      const finishing = session.finish();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(upstream.seenFrames.at(-1)?.type).toBe("session.finish");
      expect(upstream.seenFrames.some((frame) => frame.type === "input_audio_buffer.commit")).toBe(false);
      await finishing;
      expect(handlers.errors).toEqual([]);
    } finally {
      session.abort();
    }
  });

  it("does not report a finish timeout when a final was already received before session.finished", async () => {
    let commitCount = 0;
    upstream = await startFakeUpstream((frame, ws) => {
      if (frame.type === "session.update") ws.send(JSON.stringify({ type: "session.updated" }));
      if (frame.type === "input_audio_buffer.commit" && ++commitCount === 1) {
        ws.send(JSON.stringify({
          type: "conversation.item.input_audio_transcription.completed",
          transcript: "已经保存的正文",
          confidence: null,
        }));
      }
      if (frame.type === "session.finish") ws.send(JSON.stringify({ type: "session.finished" }));
    });
    const provider = new ConfiguredRealtimeAsrProvider({
      provider: "dashscope", baseUrl: `ws://127.0.0.1:${upstream.port}`, apiKey: "k", model: MODEL,
    });
    const handlers = recordingHandlers();
    const session = await provider.open(handlers, AUDIO);
    session.commit();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(handlers.finals).toEqual(["已经保存的正文"]);

    await session.finish();

    expect(commitCount).toBe(1);
    expect(upstream.seenFrames.at(-1)?.type).toBe("session.finish");
    expect(handlers.errors).toEqual([]);
  });

  it("an explicit `error` frame from upstream is reported once, not duplicated by the close that follows it", async () => {
    upstream = await startFakeUpstream((frame, ws) => {
      if (frame.type === "session.update") {
        ws.send(JSON.stringify({ type: "error", error: { message: "Audio format is not valid 'pcm16'!" } }));
        ws.close();
      }
    });
    const provider = new ConfiguredRealtimeAsrProvider({
      provider: "dashscope", baseUrl: `ws://127.0.0.1:${upstream.port}`, apiKey: "k", model: MODEL,
    });
    const handlers = recordingHandlers();
    await provider.open(handlers, AUDIO);
    await new Promise((r) => setTimeout(r, 30));
    expect(handlers.errors).toHaveLength(1);
    expect(handlers.errors[0]?.reason).toBe("AUDIO_FORMAT_REJECTED");
  });
});
