/**
 * 开发 / 测试专用的**确定性实时 OMNI 上游**（DashScope realtime 形状的 WS）。
 *
 * 网关（`interface/ws/realtime-digital-human.gateway.ts`）对上游说的协议：`session.update`、
 * `input_audio_buffer.append/commit`、`conversation.item.create` + `response.create`、`response.cancel`；
 * 上游回：`session.updated`、`input_audio_buffer.speech_started/stopped`、
 * `conversation.item.input_audio_transcription.text/.completed`、`response.audio_transcript.delta/done`、
 * `response.output_audio.delta`（测试音调 PCM）、`response.output_audio.done`、`response.done`。
 *
 * 这不是产品代码里的 fallback：只有部署/测试配置显式把 `KERNEL_OMNI_REALTIME_BASE_URL` 指到它才会被用到；
 * 没配就仍然是 `NOT_CONFIGURED` / 真实 DashScope。它回的是**可读的中文样例**，不是 loopback ASR 的
 * `[loopback-asr] <字节数>` 调试串——用户在通话里看到、并被存进线程的文字因此与真模型同形。
 *
 * 行为：收到足够的真实音频字节 ⇒ 一轮「开始说话 → 转写快照 → 说完 → 转写完成 → 助手回复（含静音 PCM）」。
 * 每个连接只自动跑一轮（Chrome 的假麦克风是连续音频，不限轮数会无限刷线程）；之后仍响应
 * `input_audio_buffer.commit`（有未转写音频时补一轮）与文字输入。
 */
import type { WebSocket } from "ws";

export const OMNI_SAMPLE_USER_TRANSCRIPT = "（模拟语音）你好，我想了解一下产品方案";
/**
 * 夹具转写前缀「（模拟语音）」只是测试数据标记：标题取材时剥掉它（仅夹具侧使用，
 * 通过 `appendRealtimeVoiceTurn` 的可选 `titleText` 注入；产品路径默认不剥任何内容）。
 */
export function stripSimulatedVoiceMarker(text: string): string {
  return text.replace(/^\s*[（(]模拟语音[）)]\s*/, "");
}
/** 16kHz s16le mono 下约 0.4 秒的输入音频，达到才判为「开始说话」。 */
const SPEECH_START_BYTES = 12_800;
/** 约 1 秒输入音频后判为「说完」。 */
const SPEECH_END_BYTES = 32_000;
const STEP_MS = 120;
/** 24kHz s16le 测试音调，约 0.2 秒一块；用于验证真实播放链，不模拟供应商语义。 */
const outputPcm = Buffer.alloc(9_600);
for (let sample = 0; sample < outputPcm.length / 2; sample += 1) {
  outputPcm.writeInt16LE(Math.round(Math.sin(sample * 2 * Math.PI * 440 / 24_000) * 1_000), sample * 2);
}
const OUTPUT_CHUNK = outputPcm.toString("base64");

export function omniAssistantReply(roleName: string | null): string {
  const who = roleName ? `我是${roleName}，` : "";
  return `${who}好的，我先帮你梳理一下产品方案的关键点，稍后给你一份简要建议。`;
}

/** 从网关下发的 instructions 里取出角色名（`数字人「X」`）；通用助手没有。 */
export function roleNameFromInstructions(instructions: unknown): string | null {
  if (typeof instructions !== "string") return null;
  return /数字人「([^」]+)」/.exec(instructions)?.[1] ?? null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface OmniLoopbackObserver {
  readonly clientEvent: (type: string) => void;
  readonly serverEvent: (type: string) => void;
  readonly audioBytes: (bytes: number) => void;
  /** Explicit browser E2E may keep a finite real PCM stream open for an actionable interrupt window. */
  readonly holdAudioMs?: number;
}

export function handleOmniRealtimeConnection(ws: WebSocket, observer?: OmniLoopbackObserver): void {
  let roleName: string | null = null;
  let ready = false;
  let bytes = 0;
  let speaking = false;
  let turns = 0;
  let busy = false;
  let cancelled = false;
  const emit = (event: Record<string, unknown>): void => {
    if (ws.readyState === ws.OPEN) {
      observer?.serverEvent(String(event.type));
      ws.send(JSON.stringify(event));
    }
  };

  const reply = async (): Promise<void> => {
    cancelled = false;
    const text = omniAssistantReply(roleName);
    emit({ type: "response.created", response: { id: "resp-loopback" } });
    const parts = Array.from(text.match(/.{1,8}/g) ?? [text]);
    for (const part of parts) {
      if (cancelled) return;
      await sleep(60);
      if (cancelled || ws.readyState !== ws.OPEN) return;
      emit({ type: "response.audio_transcript.delta", delta: part });
      emit({ type: "response.output_audio.delta", delta: OUTPUT_CHUNK });
    }
    // Text may finish quickly, while a real answer's audio is still being streamed.
    // Only an explicitly observed browser fixture requests this bounded output window.
    const holdUntil = Date.now() + Math.min(8_000, Math.max(0, observer?.holdAudioMs ?? 0));
    while (Date.now() < holdUntil) {
      await sleep(200); // 9,600-byte PCM16 chunk = 200 ms at 24 kHz, within stream contract bounds.
      if (cancelled || ws.readyState !== ws.OPEN) return;
      emit({ type: "response.output_audio.delta", delta: OUTPUT_CHUNK });
    }
    emit({ type: "response.audio_transcript.done", transcript: text });
    emit({ type: "response.output_audio.done" });
    emit({ type: "response.done", response: { id: "resp-loopback", status: "completed" } });
  };

  const userTurn = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    turns += 1;
    try {
      if (!speaking) emit({ type: "input_audio_buffer.speech_started" });
      speaking = false;
      await sleep(STEP_MS);
      emit({ type: "conversation.item.input_audio_transcription.text", text: "（模拟语音）你好，", stash: "我想了解…" });
      await sleep(STEP_MS);
      emit({ type: "input_audio_buffer.speech_stopped" });
      emit({ type: "conversation.item.input_audio_transcription.completed", transcript: OMNI_SAMPLE_USER_TRANSCRIPT });
      bytes = 0;
      await sleep(STEP_MS);
      await reply();
    } finally {
      busy = false;
    }
  };

  ws.on("message", (raw: Buffer, isBinary: boolean) => {
    if (isBinary) return;
    let event: { type?: string; audio?: string; session?: { instructions?: unknown } };
    try { event = JSON.parse(String(raw)) as typeof event; } catch { return; }
    observer?.clientEvent(String(event.type));
    if (event.type === "session.update") {
      roleName = roleNameFromInstructions(event.session?.instructions);
      ready = true;
      emit({ type: "session.updated" });
      return;
    }
    if (event.type === "input_audio_buffer.append") {
      if (!ready) { emit({ type: "error", error: { message: "audio before session update" } }); return; }
      const frameBytes = Buffer.from(String(event.audio ?? ""), "base64").byteLength;
      observer?.audioBytes(frameBytes);
      bytes += frameBytes;
      if (turns === 0 && !busy) {
        if (!speaking && bytes >= SPEECH_START_BYTES) { speaking = true; emit({ type: "input_audio_buffer.speech_started" }); }
        if (speaking && bytes >= SPEECH_END_BYTES) void userTurn();
      }
      return;
    }
    if (event.type === "input_audio_buffer.commit") {
      if (bytes > 0) void userTurn();
      return;
    }
    if (event.type === "response.cancel") { cancelled = true; return; }
    if (event.type === "response.create" && !busy) { busy = true; void reply().finally(() => { busy = false; }); }
  });
}
