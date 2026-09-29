import { chat } from "@repo/contracts";
import { apiWebSocketUrl, getStoredSessionToken, waitForSocketOpen } from "./api-client";
import { startCapture, type CaptureHandle } from "./live-recording";

const STREAM = chat.streamOperations.realtimeDigitalHuman;

export interface OmniConversationHandlers {
  readonly onReady: (model: string) => void;
  readonly onUserSpeech: (speaking: boolean) => void;
  readonly onUserTranscript: (text: string, final: boolean) => void;
  readonly onAssistantTranscript: (text: string, final: boolean) => void;
  readonly onAssistantAudio: (speaking: boolean) => void;
  readonly onError: (message: string) => void;
  readonly onClosed: () => void;
}

export interface OmniConversationHandle {
  readonly stop: () => Promise<void>;
  readonly cancelResponse: () => void;
}

export async function openOmniConversation(
  boardId: string,
  handlers: OmniConversationHandlers,
  deps: { sessionToken?: string | null; capture?: () => Promise<CaptureHandle> } = {},
): Promise<OmniConversationHandle> {
  const token = deps.sessionToken !== undefined ? deps.sessionToken : getStoredSessionToken();
  if (!token) throw new Error("请先登录后再开始实时通话");
  const socket = new WebSocket(apiWebSocketUrl(STREAM.path), [`${STREAM.bearerSubprotocolPrefix}${token}`]);
  await waitForSocketOpen(socket, () => new Error("实时通话连接失败"));

  const player = new Pcm16Player(STREAM.audio.outputSampleRate);
  let capture: CaptureHandle | null = null;
  let closed = false;
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
      handlers.onAssistantAudio(true);
      player.enqueue(frame.audio);
      return;
    }
    if (frame.type === "assistant.audio_done") return handlers.onAssistantAudio(false);
    if (frame.type === "session.error") return handlers.onError(frame.message);
    handlers.onClosed();
  });
  socket.addEventListener("close", () => {
    if (!closed) handlers.onClosed();
  });
  socket.addEventListener("error", () => handlers.onError("实时通话网络连接已中断"));
  socket.send(JSON.stringify({ type: "session.start", boardId }));

  try {
    capture = await (deps.capture?.() ?? startCapture());
  } catch (error) {
    socket.close();
    await player.close();
    throw error;
  }
  capture.onFrame((frame) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
  });

  return {
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
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "session.stop" }));
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
