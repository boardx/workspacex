import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket as UpstreamWebSocket, WebSocketServer, type WebSocket } from "ws";
import { chat as C } from "@repo/contracts";
import type { PrincipalResolverPort } from "../../application/ports/principal-resolver.port";
import type { Principal } from "../../domain/principal";
import {
  DEFAULT_REALTIME_VOICE,
  parseRealtimeVoiceMap,
  type RealtimeVoiceMap,
} from "../../domain/chat/realtime-voice-persona";
import {
  RealtimeVoiceAgentUnavailableError,
  RealtimeVoiceThreadUnavailableError,
  type RealtimeVoiceSession,
  type RealtimeVoiceSessionPort,
} from "../../application/chat/realtime-voice-session";

const STREAM = C.streamOperations.realtimeDigitalHuman;
type ServerFrame = typeof STREAM.server._type;
type ErrorReason = typeof STREAM.err._type;

export interface RealtimeDigitalHumanGatewayDeps {
  readonly principals: PrincipalResolverPort;
  /**
   * Chat 语音模式（`session.start.threadId`）的判权/人设/落库依赖。缺省时 Chat 宿主一律按
   * THREAD_UNAVAILABLE 拒绝（fail closed），白板 POC 不受影响。
   */
  readonly voice?: RealtimeVoiceSessionPort;
  /** 测试注入；缺省读环境变量（`readRealtimeModelConfig`）。 */
  readonly config?: () => RealtimeModelConfig;
}

export interface RealtimeModelConfig {
  readonly baseUrl: string | undefined;
  readonly apiKey: string | undefined;
  readonly model: string;
  readonly defaultVoice: string;
  readonly voiceMap: RealtimeVoiceMap;
  /** 用户语音转写模型（Qwen omni realtime 不开 `input_audio_transcription` 就不回用户转写，挂断后线程里只剩空）。 */
  readonly transcriptionModel?: string;
}

/** 固定沿用 #4549 POC 的 Omni 协议模型；文字/ASR/部署覆盖不能更换实时对话协议。 */
export const REALTIME_CONVERSATION_MODEL = "qwen3.8-omni-flash-realtime";

export function readRealtimeModelConfig(env: NodeJS.ProcessEnv = process.env): RealtimeModelConfig {
  return {
    baseUrl: workspaceRealtimeUrl(env.KERNEL_MODEL_BASE_URL),
    apiKey: env.KERNEL_MODEL_API_KEY?.trim() || undefined,
    model: REALTIME_CONVERSATION_MODEL,
    defaultVoice: env.KERNEL_OMNI_REALTIME_VOICE ?? DEFAULT_REALTIME_VOICE,
    voiceMap: parseRealtimeVoiceMap(env.KERNEL_OMNI_REALTIME_VOICE_MAP),
    transcriptionModel: env.KERNEL_OMNI_REALTIME_TRANSCRIPTION_MODEL ?? "gummy-realtime-v1",
  };
}

const FRIENDLY: Record<ErrorReason, string> = {
  NOT_CONFIGURED: "实时语音模型尚未配置，请联系管理员",
  AGENT_UNAVAILABLE: "这个数字人暂不可用，可能尚未发布或你没有使用权限",
  THREAD_UNAVAILABLE: "当前对话不可用或你没有发言权限",
  UPSTREAM_FAILED: "实时模型暂时不可用，请稍后重试",
  INVALID_FRAME: "实时会话数据异常，请重新开始",
};

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
      wss.handleUpgrade(request, socket, head, (ws) => serve(ws, principal, deps));
    })().catch(() => refuse(socket, 503, "Service Unavailable"));
  });
  return wss;
}

interface UpstreamPlan {
  readonly instructions: string;
  readonly voice: string;
  readonly session: RealtimeVoiceSession | null;
}

function serve(client: WebSocket, principal: Principal, deps: RealtimeDigitalHumanGatewayDeps): void {
  const config = (deps.config ?? readRealtimeModelConfig)();
  const { baseUrl, apiKey, model } = config;
  const send = (frame: ServerFrame): void => {
    if (client.readyState === client.OPEN) client.send(JSON.stringify(STREAM.server.parse(frame)));
  };
  const fail = (reason: ErrorReason): void => send({ type: "session.error", reason, message: FRIENDLY[reason] });
  if (!baseUrl || !apiKey) {
    fail("NOT_CONFIGURED");
    client.close();
    return;
  }

  let upstream: UpstreamWebSocket | null = null;
  let started = false;
  let voiceSession: RealtimeVoiceSession | null = null;
  let assistantDraft = "";
  let persistChain: Promise<void> = Promise.resolve();
  const pendingAudio: Buffer[] = [];
  /** 上游有没有发过音频 / 是否跑 server VAD / 用户是否有一句还没转写完——决定挂断时要不要补一次 commit。 */
  let audioSent = false;
  let vadSeen = false;
  let speechOpen = false;
  let userTranscriptSettled: (() => void) | null = null;
  let hangingUp = false;
  const close = (): void => {
    if (upstream?.readyState === UpstreamWebSocket.OPEN || upstream?.readyState === UpstreamWebSocket.CONNECTING) upstream.close();
    upstream = null;
  };
  /** 按到达顺序串行落库；落库失败不打断通话，只记日志。 */
  const persist = (role: "user" | "assistant", text: string): void => {
    const session = voiceSession;
    const port = deps.voice;
    if (!session || !port || text.trim().length === 0) return;
    persistChain = persistChain
      .then(async () => {
        const messageId = await port.append(session, { role, text });
        if (messageId) send({ type: "turn.persisted", role, messageId });
      })
      .catch(() => { process.stderr.write("[realtime-digital-human] transcript persist failed\n"); });
  };
  const flushAssistant = (): void => {
    const text = assistantDraft;
    assistantDraft = "";
    persist("assistant", text);
  };

  const openUpstream = (plan: UpstreamPlan): void => {
    voiceSession = plan.session;
    const socket = new UpstreamWebSocket(`${baseUrl}?model=${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${apiKey}`, "OpenAI-Beta": "realtime=v1" },
    });
    upstream = socket;
    socket.on("open", () => {
      socket.send(JSON.stringify({
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          instructions: plan.instructions,
          audio: {
            input: { format: { type: "pcm", sample_rate: STREAM.audio.inputSampleRate, sample_format: "s16le", channels: 1, packing: "interleaved", channel_layout: "mono" } },
            output: { voice: plan.voice, format: { type: "pcm", sample_rate: STREAM.audio.outputSampleRate } },
          },
          input_audio_transcription: { model: config.transcriptionModel ?? "gummy-realtime-v1" },
          turn_detection: { type: "server_vad", threshold: 0.2, silence_duration_ms: 600 },
        },
      }));
      for (const audio of pendingAudio.splice(0)) {
        socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: audio.toString("base64") }));
        audioSent = true;
      }
    });
    socket.on("message", (message) => {
      const event = normaliseUpstreamEvent(safeJson(String(message)));
      if (!event) return;
      if (event.type === "session.updated") send({ type: "session.ready", model });
      // 转写落库：用户一句说完 / 数字人一段说完（或被打断）各落一条。
      if (event.type === "conversation.item.input_audio_transcription.completed" && typeof event.transcript === "string") {
        speechOpen = false;
        persist("user", event.transcript);
        userTranscriptSettled?.();
      }
      if (event.type === "input_audio_buffer.speech_started") {
        vadSeen = true;
        speechOpen = true;
        flushAssistant();
      }
      if (event.type === "response.audio_transcript.delta" && typeof event.delta === "string") assistantDraft += event.delta;
      if (event.type === "response.audio_transcript.done") {
        assistantDraft = typeof event.transcript === "string" && event.transcript.trim() ? event.transcript : assistantDraft;
        flushAssistant();
      }
      forwardUpstream(event, send, fail);
    });
    socket.on("error", () => fail("UPSTREAM_FAILED"));
    socket.on("close", () => {
      if (upstream !== socket || hangingUp) return;
      hangingUp = true;
      flushAssistant();
      // 上游断开仍须让最后一轮完成落库并发出 turn.persisted，再通知客户端刷新线程。
      // append 卡住时有界结束；未落库的轮次不会伪造 persisted 确认。
      void Promise.race([persistChain, delay(HANGUP_PERSIST_WAIT_MS)]).finally(() => {
        close();
        send({ type: "session.closed" });
        client.close();
      });
    });
  };

  client.on("message", (raw: Buffer, isBinary: boolean) => {
    if (isBinary) {
      if (!started) return;
      if (upstream?.readyState !== UpstreamWebSocket.OPEN) {
        if (pendingAudio.reduce((sum, item) => sum + item.byteLength, 0) < 960_000) pendingAudio.push(Buffer.from(raw));
        return;
      }
      upstream.send(JSON.stringify({ type: "input_audio_buffer.append", audio: raw.toString("base64") }));
      audioSent = true;
      return;
    }
    const parsed = STREAM.client.safeParse(safeJson(String(raw)));
    if (!parsed.success) return fail("INVALID_FRAME");
    const frame = parsed.data;
    if (frame.type === "session.start") {
      if (started) return;
      const hasBoard = frame.boardId !== undefined;
      const hasThread = frame.threadId !== undefined;
      if (hasBoard === hasThread || (hasBoard && frame.agentId !== undefined)) return fail("INVALID_FRAME");
      started = true;
      if (frame.boardId !== undefined) {
        openUpstream({
          instructions: `你是 WorkspaceX 中文数字人助手。当前白板 ID 是 ${frame.boardId}。像真人面对面交流一样自然、温和、简洁地回答，使用口语化短句和自然停顿，避免播音腔。`,
          voice: config.defaultVoice,
          session: null,
        });
        return;
      }
      const threadId = frame.threadId!;
      const voice = deps.voice;
      void (async () => {
        if (!voice) throw new RealtimeVoiceThreadUnavailableError();
        return voice.open({ orgId: principal.orgId, userId: principal.userId, threadId, agentId: frame.agentId ?? null });
      })().then(
        (session) => {
          if (client.readyState !== client.OPEN) return;
          openUpstream({ instructions: session.instructions, voice: session.voice, session });
        },
        (error: unknown) => {
          fail(error instanceof RealtimeVoiceAgentUnavailableError ? "AGENT_UNAVAILABLE"
            : error instanceof RealtimeVoiceThreadUnavailableError ? "THREAD_UNAVAILABLE" : "UPSTREAM_FAILED");
          client.close();
        },
      );
      return;
    }
    if (frame.type === "response.cancel") {
      flushAssistant();
      if (upstream?.readyState === UpstreamWebSocket.OPEN) upstream.send(JSON.stringify({ type: "response.cancel" }));
      return;
    }
    if (frame.type === "conversation.text") {
      if (upstream?.readyState === UpstreamWebSocket.OPEN) {
        upstream.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: frame.text }] } }));
        upstream.send(JSON.stringify({ type: "response.create" }));
      }
      return;
    }
    // session.stop（挂断）：先把上游还没断句的那段话提交转写并等它落库，再回 session.closed——
    // 否则「说完立刻挂断」的最后一句永远不会进线程（uiux-r4：挂断后线程为空）。
    if (hangingUp) return;
    hangingUp = true;
    void settleBeforeHangup().finally(() => {
      close();
      send({ type: "session.closed" });
      client.close();
    });
  });
  client.on("close", () => { if (!hangingUp) { flushAssistant(); close(); } });

  const settleBeforeHangup = async (): Promise<void> => {
    flushAssistant();
    const socket = upstream;
    // 有 server VAD 时只在「一句话说到一半」才补 commit；上游不做 VAD（只在 commit 时转写）时，发过音频就补。
    if (socket?.readyState === UpstreamWebSocket.OPEN && audioSent && (vadSeen ? speechOpen : true)) {
      const settled = new Promise<void>((resolve) => { userTranscriptSettled = resolve; });
      socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      await Promise.race([settled, delay(HANGUP_TRANSCRIPT_WAIT_MS)]);
      userTranscriptSettled = null;
    }
    flushAssistant();
    await Promise.race([persistChain, delay(HANGUP_PERSIST_WAIT_MS)]);
  };
}

/** 挂断时等最后一句转写 / 落库的上限：到点就收尾，不让挂断卡住。 */
const HANGUP_TRANSCRIPT_WAIT_MS = 2_500;
const HANGUP_PERSIST_WAIT_MS = 2_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref?.());
}

/** OpenAI GA 事件名（`response.output_audio*`）与 beta / Qwen 事件名（`response.audio*`）统一成后者。 */
const EVENT_ALIASES: Record<string, string> = {
  "response.output_audio_transcript.delta": "response.audio_transcript.delta",
  "response.output_audio_transcript.done": "response.audio_transcript.done",
  "response.output_audio.delta": "response.audio.delta",
  "response.output_audio.done": "response.audio.done",
};

function normaliseUpstreamEvent(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if (typeof event.type !== "string") return null;
  const alias = EVENT_ALIASES[event.type];
  return alias ? { ...event, type: alias } : event;
}

function forwardUpstream(event: Record<string, unknown>, send: (frame: ServerFrame) => void, fail: (reason: ErrorReason) => void): void {
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
    fail("UPSTREAM_FAILED");
  }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

function workspaceRealtimeUrl(modelBaseUrl: string | undefined): string | undefined {
  if (!modelBaseUrl) return undefined;
  try {
    const url = new URL(modelBaseUrl);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    if (!url.hostname.endsWith(".maas.aliyuncs.com") && url.hostname !== "dashscope.aliyuncs.com") return undefined;
    url.protocol = "wss:";
    url.pathname = "/api-ws/v1/realtime";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}
