/**
 * The wire protocol -- the SAME frames `apps/api`'s `ConfiguredRealtimeAsrProvider` sends to
 * DashScope's realtime endpoint, answered locally:
 *
 *   client → gateway
 *     session.update            { session: { input_audio_format, sample_rate, input_audio_transcription:{model}, turn_detection } }
 *     input_audio_buffer.append { audio: base64 pcm16le }
 *     input_audio_buffer.commit
 *     session.finish            (manual mode only)
 *   gateway → client
 *     conversation.item.input_audio_transcription.text       { text, stash }           partial
 *     conversation.item.input_audio_transcription.completed  { transcript, item_id, event_id, confidence }
 *     session.finished                                       (manual mode, after session.finish)
 *     error                                                  { error: { message } }
 *
 * Two turn-detection modes, mirrored from the provider:
 *   server_vad (default) -- the engine's endpointing closes segments on its own; a commit
 *                           also closes the current one.
 *   manual (turn_detection: null) -- only commit closes a segment; session.finish ends it.
 *
 * On a commit with nothing to transcribe after at least one final, DashScope answers with a
 * "buffer too small" error which the provider explicitly treats as benign; we send the same
 * so `finish()` resolves the same way. Documented in the provider file, mirrored here.
 */
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { pcm16leToFloat32, type Engine, type EngineSession } from "./engine";

export interface GatewayOptions {
  readonly engine: Engine;
  readonly host?: string;
  readonly port: number;
  /** How often (ms) to run decoding + emit partials while audio is arriving. */
  readonly tickMs?: number;
  readonly log?: (line: string) => void;
}

export interface GatewayHandle {
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

type Frame =
  | { type: "session.update"; session?: { sample_rate?: number; input_audio_format?: string; turn_detection?: unknown } }
  | { type: "input_audio_buffer.append"; audio?: string }
  | { type: "input_audio_buffer.commit" }
  | { type: "session.finish" }
  | { type: string };

export async function startGateway(opts: GatewayOptions): Promise<GatewayHandle> {
  const host = opts.host ?? "127.0.0.1";
  const log = opts.log ?? (() => undefined);
  const http: Server = createServer((req, res) => {
    if (req.url === "/healthz") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, engine: opts.engine.name })); return; }
    res.writeHead(404); res.end();
  });
  const wss = new WebSocketServer({ server: http });
  wss.on("connection", (socket, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    handleConnection(socket, opts.engine, { model: url.searchParams.get("model") ?? "", tickMs: opts.tickMs ?? 200, log });
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(opts.port, host, () => { http.off("error", reject); resolve(); });
  });
  const addr = http.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port;
  log(`[local-asr-gateway] listening ws://${host}:${port} engine=${opts.engine.name}`);
  return {
    port,
    url: `ws://${host}:${port}`,
    close: () => new Promise<void>((resolve) => {
      for (const c of wss.clients) c.terminate();
      wss.close(() => http.close(() => resolve()));
    }),
  };
}

function handleConnection(socket: WebSocket, engine: Engine, ctx: { model: string; tickMs: number; log: (l: string) => void }): void {
  let session: EngineSession | null = null;
  let manual = false;
  let sampleRate = 16_000;
  let finalSeenEver = false;
  let pendingAudio = false;
  let lastPartial = "";
  let timer: NodeJS.Timeout | null = null;
  const send = (frame: Record<string, unknown>): void => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
  };
  const sendError = (message: string): void => send({ type: "error", error: { type: "invalid_request_error", message } });
  const emitFinal = (text: string): void => {
    finalSeenEver = true;
    lastPartial = "";
    send({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: `item_${randomUUID()}`,
      event_id: `event_${randomUUID()}`,
      transcript: text,
      confidence: null,
    });
  };
  const tick = (): void => {
    if (!session || !pendingAudio) return;
    pendingAudio = false;
    const { stable, tail } = session.decode();
    const partial = `${stable}${tail}`;
    if (partial !== "" && partial !== lastPartial) {
      lastPartial = partial;
      send({ type: "conversation.item.input_audio_transcription.text", text: stable, stash: tail });
    }
    if (!manual && session.endpointReached()) {
      const text = session.finalizeSegment();
      if (text !== "") emitFinal(text);
    }
  };
  const closeSegmentOnCommit = (): void => {
    if (!session) { sendError("session.update must precede input_audio_buffer.commit"); return; }
    const text = session.finalizeSegment();
    if (text !== "") { emitFinal(text); return; }
    if (finalSeenEver) { sendError("input audio buffer is too small (0.0 ms of audio)"); return; }
    emitFinal("");
  };

  socket.on("message", (raw) => {
    let frame: Frame;
    try { frame = JSON.parse(String(raw)) as Frame; } catch { sendError("frame is not JSON"); return; }
    switch (frame.type) {
      case "session.update": {
        const s = (frame as Extract<Frame, { type: "session.update" }>).session ?? {};
        const fmt = (s.input_audio_format ?? "pcm").toLowerCase();
        if (!/^pcm/.test(fmt)) { sendError(`unsupported input_audio_format ${fmt}: only pcm16le is accepted`); return; }
        sampleRate = typeof s.sample_rate === "number" && s.sample_rate > 0 ? s.sample_rate : 16_000;
        manual = "turn_detection" in s && s.turn_detection === null;
        session?.close();
        session = engine.createSession(sampleRate);
        if (!timer) timer = setInterval(tick, ctx.tickMs);
        send({ type: "session.updated", session: { input_audio_format: "pcm", sample_rate: sampleRate, model: ctx.model, engine: engine.name } });
        return;
      }
      case "input_audio_buffer.append": {
        if (!session) { sendError("session.update must precede input_audio_buffer.append"); return; }
        const b64 = (frame as Extract<Frame, { type: "input_audio_buffer.append" }>).audio;
        if (typeof b64 !== "string") { sendError("audio must be a base64 string"); return; }
        session.accept(pcm16leToFloat32(Buffer.from(b64, "base64")));
        pendingAudio = true;
        return;
      }
      case "input_audio_buffer.commit":
        tick();
        closeSegmentOnCommit();
        return;
      case "session.finish":
        if (!manual) { sendError("session.finish is only valid with turn_detection: null"); return; }
        send({ type: "session.finished" });
        socket.close(1000, "finished");
        return;
      default:
        ctx.log(`[local-asr-gateway] ignoring frame type ${frame.type}`);
    }
  });
  socket.on("close", () => {
    if (timer) clearInterval(timer);
    timer = null;
    session?.close();
    session = null;
  });
}
