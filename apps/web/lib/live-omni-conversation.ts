import { chat } from "@repo/contracts";
import { apiWebSocketUrl, getStoredSessionToken, waitForSocketOpen } from "./api-client";
import { LiveRecordingError, startCapture, type CaptureHandle } from "./live-recording";

const STREAM = chat.streamOperations.realtimeDigitalHuman;

/** 服务端失败原因（契约 `streamOperations.realtimeDigitalHuman.err`）。 */
export type OmniErrorReason = typeof STREAM.err._type;

/**
 * 会话宿主：白板 POC 传 `boardId`；Chat 语音模式传 `threadId` + 所选数字人（null = 通用助手）。
 * 模型与音色不在这里——服务端按角色解析（ADR-121）。
 */
export type OmniConversationTarget =
  | { readonly boardId: string }
  | { readonly threadId: string; readonly agentId: string | null };

export interface OmniConversationHandlers {
  readonly onReady: (model: string) => void;
  readonly onUserSpeech: (speaking: boolean) => void;
  readonly onUserTranscript: (text: string, final: boolean) => void;
  readonly onAssistantTranscript: (text: string, final: boolean) => void;
  readonly onAssistantAudio: (speaking: boolean) => void;
  /** `reason` 缺省表示客户端侧网络/数据问题（不是服务端判定）。 */
  readonly onError: (message: string, reason?: OmniErrorReason) => void;
  readonly onClosed: () => void;
  readonly onTurnPersisted?: (role: "user" | "assistant", messageId: string) => void;
  /** 麦克风输入电平 0..1（每帧 RMS，静音时报 0）——界面据此画输入电平条。 */
  readonly onInputLevel?: (level: number) => void;
}

/** 挂断时等服务端把最后一句转写落库并回 `session.closed` 的上限。 */
export const STOP_SETTLE_TIMEOUT_MS = 6_000;

/** PCM16 帧的 RMS 电平，映射到 0..1（语音 RMS 通常远小于满幅，乘个增益让条看得见）。 */
export function pcm16Level(frame: Int16Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) { const v = frame[i]! / 32768; sum += v * v; }
  return Math.min(1, Math.sqrt(sum / frame.length) * 4);
}

export interface OmniConversationHandle {
  readonly stop: () => Promise<void>;
  readonly cancelResponse: () => void;
  /** 静音 = 不再上送麦克风帧（服务端 VAD 因此不会判定用户在说话）。 */
  readonly setMuted: (muted: boolean) => void;
}

/** 启动阶段的失败分类——界面据此给友好文案，不展示原始错误。 */
export type OmniStartFailure = "unauthenticated" | "connect-failed" | "mic-denied" | "mic-unavailable";
export class OmniConversationStartError extends Error {
  constructor(readonly kind: OmniStartFailure) {
    super(kind);
    this.name = "OmniConversationStartError";
  }
}

const START_FAILURE_TEXT: Record<OmniStartFailure, string> = {
  unauthenticated: "请先登录后再开始实时通话",
  "connect-failed": "实时通话连接失败，请检查网络后重试",
  "mic-denied": "麦克风权限被拒绝，请在浏览器地址栏允许使用麦克风后重试",
  "mic-unavailable": "没有检测到可用的麦克风，请连接麦克风后重试",
};

/** 启动失败 → 友好文案（未知失败给通用文案，不透出原始错误）。 */
export function describeOmniStartFailure(error: unknown): string {
  return error instanceof OmniConversationStartError ? START_FAILURE_TEXT[error.kind] : "实时通话启动失败，请稍后重试";
}

export async function openOmniConversation(
  target: string | OmniConversationTarget,
  handlers: OmniConversationHandlers,
  deps: { sessionToken?: string | null; capture?: () => Promise<CaptureHandle> } = {},
): Promise<OmniConversationHandle> {
  const token = deps.sessionToken !== undefined ? deps.sessionToken : getStoredSessionToken();
  if (!token) throw new OmniConversationStartError("unauthenticated");
  const socket = new WebSocket(apiWebSocketUrl(STREAM.path), [`${STREAM.bearerSubprotocolPrefix}${token}`]);
  await waitForSocketOpen(socket, () => new OmniConversationStartError("connect-failed"));

  const player = new Pcm16Player(STREAM.audio.outputSampleRate);
  let capture: CaptureHandle | null = null;
  let closed = false;
  let muted = false;
  let settle: (() => void) | null = null;
  socket.addEventListener("message", (event) => {
    const parsed = STREAM.server.safeParse(safeJson(String(event.data)));
    if (!parsed.success) return handlers.onError("实时模型返回了无法识别的数据");
    const frame = parsed.data;
    if (frame.type === "session.ready") return handlers.onReady(frame.model);
    if (frame.type === "user.speech_started") {
      player.interrupt();
      handlers.onAssistantAudio(false);
      return handlers.onUserSpeech(true);
    }
    if (frame.type === "user.speech_stopped") return handlers.onUserSpeech(false);
    if (frame.type === "user.transcript") return handlers.onUserTranscript(frame.text, frame.final);
    if (frame.type === "assistant.transcript") return handlers.onAssistantTranscript(frame.text, frame.final);
    if (frame.type === "assistant.audio") {
      if (closed) return; // 挂断收尾期间不再出声
      handlers.onAssistantAudio(true);
      player.enqueue(frame.audio);
      return;
    }
    if (frame.type === "assistant.audio_done") return handlers.onAssistantAudio(false);
    if (frame.type === "session.error") return handlers.onError(frame.message, frame.reason);
    if (frame.type === "turn.persisted") return handlers.onTurnPersisted?.(frame.role, frame.messageId);
    if (settle) return settle();
    handlers.onClosed();
  });
  socket.addEventListener("close", () => {
    settle?.();
    if (!closed) handlers.onClosed();
  });
  socket.addEventListener("error", () => handlers.onError("实时通话网络连接已中断"));
  const start = typeof target === "string" ? { boardId: target } : target;
  socket.send(JSON.stringify({ type: "session.start", ...start }));

  try {
    capture = await (deps.capture?.() ?? startCapture());
  } catch (error) {
    closed = true;
    socket.close();
    await player.close();
    const denied = error instanceof LiveRecordingError && error.kind === "permission-denied";
    throw new OmniConversationStartError(denied ? "mic-denied" : "mic-unavailable");
  }
  capture.onFrame((frame) => {
    handlers.onInputLevel?.(muted ? 0 : pcm16Level(frame));
    if (muted) return;
    if (socket.readyState === WebSocket.OPEN) socket.send(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
  });

  return {
    setMuted: (value) => { muted = value; },
    cancelResponse: () => {
      player.interrupt();
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "response.cancel" }));
      handlers.onAssistantAudio(false);
    },
    stop: async () => {
      if (closed) return;
      closed = true;
      await capture?.stop();
      await player.close();
      // 挂断：告诉服务端收尾，等它把最后一句转写落库（期间照常收 turn.persisted）并回 session.closed，
      // 再关连接——直接关会丢掉「说完立刻挂断」的那一句（uiux-r4：挂断后线程为空）。
      if (socket.readyState === WebSocket.OPEN) {
        const settled = new Promise<void>((resolve) => { settle = resolve; });
        socket.send(JSON.stringify({ type: "session.stop" }));
        await Promise.race([settled, new Promise<void>((resolve) => setTimeout(resolve, STOP_SETTLE_TIMEOUT_MS))]);
      }
      socket.close();
      handlers.onClosed();
    },
  };
}

class Pcm16Player {
  private context: AudioContext | null = null;
  private nextStart = 0;
  private sources = new Set<AudioBufferSourceNode>();
  constructor(private readonly sampleRate: number) {}

  enqueue(base64: string): void {
    this.context ??= new AudioContext();
    void this.context.resume();
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const audio = this.context.createBuffer(1, Math.floor(bytes.byteLength / 2), this.sampleRate);
    const channel = audio.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) channel[index] = view.getInt16(index * 2, true) / 32768;
    const source = this.context.createBufferSource();
    source.buffer = audio;
    source.connect(this.context.destination);
    source.onended = () => this.sources.delete(source);
    const startAt = Math.max(this.context.currentTime + 0.02, this.nextStart);
    source.start(startAt);
    this.nextStart = startAt + audio.duration;
    this.sources.add(source);
  }

  interrupt(): void {
    for (const source of this.sources) try { source.stop(); } catch { /* already ended */ }
    this.sources.clear();
    this.nextStart = this.context?.currentTime ?? 0;
  }

  async close(): Promise<void> {
    this.interrupt();
    await this.context?.close();
    this.context = null;
  }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}
