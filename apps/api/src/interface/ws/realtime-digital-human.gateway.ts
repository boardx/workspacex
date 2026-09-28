import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket as UpstreamWebSocket, WebSocketServer, type WebSocket } from "ws";
import { chat as C } from "@repo/contracts";
import type { PrincipalResolverPort } from "../../application/ports/principal-resolver.port";

const STREAM = C.streamOperations.realtimeDigitalHuman;
type ServerFrame = typeof STREAM.server._type;

export interface RealtimeDigitalHumanGatewayDeps {
  readonly principals: PrincipalResolverPort;
}

function refuse(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function attachRealtimeDigitalHumanGateway(server: Server, deps: RealtimeDigitalHumanGatewayDeps): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const url = request.url ?? "";
    if (!(url === STREAM.path || url.startsWith(`${STREAM.path}?`))) return;
    void (async () => {
      const offered = String(request.headers["sec-websocket-protocol"] ?? "").split(",").map((value) => value.trim());
      const bearer = offered.find((value) => value.startsWith(STREAM.bearerSubprotocolPrefix));
      if (!bearer) return refuse(socket, 401, "Unauthorized");
      const principal = await deps.principals.resolve({ authorization: `Bearer ${bearer.slice(STREAM.bearerSubprotocolPrefix.length)}` });
      if (!principal) return refuse(socket, 401, "Unauthorized");
      wss.handleUpgrade(request, socket, head, (ws) => serve(ws));
    })().catch(() => refuse(socket, 503, "Service Unavailable"));
  });
  return wss;
}

function serve(client: WebSocket): void {
  const baseUrl = process.env.KERNEL_OMNI_REALTIME_BASE_URL ?? workspaceRealtimeUrl(process.env.KERNEL_MODEL_BASE_URL) ?? process.env.KERNEL_ASR_BASE_URL;
  const apiKey = process.env.KERNEL_OMNI_REALTIME_API_KEY ?? process.env.KERNEL_ASR_API_KEY ?? process.env.DASHSCOPE_API_KEY;
  const model = process.env.KERNEL_OMNI_REALTIME_MODEL ?? "qwen3.8-omni-flash-realtime";
  const send = (frame: ServerFrame): void => {
    if (client.readyState === client.OPEN) client.send(JSON.stringify(STREAM.server.parse(frame)));
  };
  if (!baseUrl || !apiKey) {
    send({ type: "session.error", message: "实时数字人模型尚未配置" });
    client.close();
    return;
  }

  let upstream: UpstreamWebSocket | null = null;
  let started = false;
  const pendingAudio: Buffer[] = [];
  const close = (): void => {
    if (upstream?.readyState === UpstreamWebSocket.OPEN) upstream.close();
    upstream = null;
  };

  client.on("message", (raw: Buffer, isBinary: boolean) => {
    if (isBinary) {
      if (!started) return;
      if (upstream?.readyState !== UpstreamWebSocket.OPEN) {
        if (pendingAudio.reduce((sum, item) => sum + item.byteLength, 0) < 960_000) pendingAudio.push(Buffer.from(raw));
        return;
      }
      upstream.send(JSON.stringify({ type: "input_audio_buffer.append", audio: raw.toString("base64") }));
      return;
    }
    const parsed = STREAM.client.safeParse(safeJson(String(raw)));
    if (!parsed.success) return send({ type: "session.error", message: "客户端实时会话帧无效" });
    if (parsed.data.type === "session.start") {
      if (started) return;
      started = true;
      const boardId = parsed.data.boardId;
      upstream = new UpstreamWebSocket(`${baseUrl}?model=${encodeURIComponent(model)}`, {
        headers: { Authorization: `Bearer ${apiKey}`, "OpenAI-Beta": "realtime=v1" },
      });
      upstream.on("open", () => {
        upstream?.send(JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            instructions: `你是 WorkspaceX 中文数字人助手。当前白板 ID 是 ${boardId}。回答自然、简洁，适合实时口语交流。`,
            audio: {
              input: { format: { type: "pcm", sample_rate: STREAM.audio.inputSampleRate, sample_format: "s16le", channels: 1, packing: "interleaved", channel_layout: "mono" } },
              output: { voice: "longanlingxin", format: { type: "pcm", sample_rate: STREAM.audio.outputSampleRate } },
            },
            turn_detection: { type: "server_vad", threshold: 0.2, silence_duration_ms: 600 },
          },
        }));
        for (const audio of pendingAudio.splice(0)) {
          upstream?.send(JSON.stringify({ type: "input_audio_buffer.append", audio: audio.toString("base64") }));
        }
      });
      upstream.on("message", (message) => {
        const event = safeJson(String(message)) as { type?: unknown } | null;
        if (event?.type === "session.updated") send({ type: "session.ready", model });
        forwardUpstream(message, send);
      });
      upstream.on("error", () => send({ type: "session.error", message: "实时模型网络连接失败" }));
      upstream.on("close", () => { send({ type: "session.closed" }); client.close(); });
      return;
    }
    if (parsed.data.type === "response.cancel") {
      if (upstream?.readyState === UpstreamWebSocket.OPEN) upstream.send(JSON.stringify({ type: "response.cancel" }));
      return;
    }
    if (parsed.data.type === "conversation.text") {
      if (upstream?.readyState === UpstreamWebSocket.OPEN) {
        upstream.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: parsed.data.text }] } }));
        upstream.send(JSON.stringify({ type: "response.create" }));
      }
      return;
    }
    close();
    send({ type: "session.closed" });
    client.close();
  });
  client.on("close", close);
}

function forwardUpstream(raw: unknown, send: (frame: ServerFrame) => void): void {
  const event = safeJson(String(raw)) as Record<string, unknown> | null;
  if (!event || typeof event.type !== "string") return;
  const text = typeof event.delta === "string" ? event.delta
    : typeof event.transcript === "string" ? event.transcript
    : typeof event.text === "string" ? event.text : "";
  if (event.type === "input_audio_buffer.speech_started") return send({ type: "user.speech_started" });
  if (event.type === "input_audio_buffer.speech_stopped") return send({ type: "user.speech_stopped" });
  if (event.type === "conversation.item.input_audio_transcription.text") return send({ type: "user.transcript", text, final: false });
  if (event.type === "conversation.item.input_audio_transcription.completed") return send({ type: "user.transcript", text, final: true });
  if (event.type === "response.audio_transcript.delta") return send({ type: "assistant.transcript", text, final: false });
  if (event.type === "response.audio_transcript.done") return send({ type: "assistant.transcript", text, final: true });
  if (event.type === "response.audio.delta" && typeof event.delta === "string") return send({ type: "assistant.audio", audio: event.delta });
  if (event.type === "response.audio.done") return send({ type: "assistant.audio_done" });
  if (event.type === "error") {
    process.stderr.write(`[realtime-digital-human] upstream error: ${JSON.stringify(event.error ?? {})}\n`);
    send({ type: "session.error", message: "实时模型返回错误，请稍后重试" });
  }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

function workspaceRealtimeUrl(modelBaseUrl: string | undefined): string | undefined {
  if (!modelBaseUrl) return undefined;
  try {
    const url = new URL(modelBaseUrl);
    if (!url.hostname.endsWith(".maas.aliyuncs.com")) return undefined;
    url.protocol = "wss:";
    url.pathname = "/api-ws/v1/realtime";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}
