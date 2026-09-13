/**
 * live-asr-draft.ts —— issue #726：composer 麦克风按钮的语音转录，**不落库**。
 *
 * 姊妹文件是 `live-asr.ts`（issue #466，`WS /recording/sessions/:sessionId/asr-stream`）。
 * 两者共享同一段真实采音代码（`live-recording.ts` 的 `startCapture`），走的是**不同**
 * 的 WS 面：这个文件打的是 `WS /chat/asr-draft`（契约见 `packages/contracts/src/chat.ts`
 * 的 `streamOperations.streamAsrDraft`），没有 sessionId、没有 messageId，转录结果只回给
 * 发起请求的浏览器、填进 composer 输入框，不产生任何 `recording_segments` 行。
 *
 * ## 这个文件同样不认识任何 ASR 厂商
 *
 * 与 `live-asr.ts` 相同的理由：上游是谁、key 是什么，浏览器永远不知道——服务端代理
 * 是这条面存在的全部理由（`apps/api/src/interface/ws/asr-draft.gateway.ts` 头注）。
 */
import { chat } from "@repo/contracts";
import type { z } from "zod";
import { apiWebSocketUrl, getStoredSessionToken, waitForSocketOpen } from "./api-client";
import { startCapture, type CaptureHandle } from "./live-recording";

export type AsrDraftErrorReason = z.infer<typeof chat.ChatAsrDraftErrorReason>;

const STREAM = chat.streamOperations.streamAsrDraft;

export interface AsrDraftStreamHandlers {
  readonly onPartial: (text: string) => void;
  /** 与 `live-asr.ts` 的 `onFinal` 不同：这里没有 `segmentId`——这段文本从未落库。 */
  readonly onFinal: (text: string) => void;
  readonly onError: (reason: AsrDraftErrorReason) => void;
  readonly onFinished: () => void;
  /**
   * TW-P0-5⑥ —— composer 录音态的「音量指示」。每一帧真实采到的 PCM16
   * （`capture.onFrame`，见下方）都会算一次 RMS 并回调一次，不是伪造的动画曲线。
   * 可选：不传（既有调用方 `use-asr-draft.ts` 之外的任何调用方）行为逐字节不变。
   */
  readonly onLevel?: (level: number) => void;
}

/**
 * 从一帧真实 PCM16 采样算一个 0..1 的电平值（RMS，乘 4 放大到可视范围并夹顶）。
 * 纯函数，供 `openAsrDraftStream` 与其单测共用——不是在渲染层现算一个假动画。
 */
export function pcm16Level(frame: Int16Array): number {
  if (frame.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < frame.length; i += 1) {
    const normalized = frame[i]! / 0x8000;
    sumSquares += normalized * normalized;
  }
  const rms = Math.sqrt(sumSquares / frame.length);
  return Math.max(0, Math.min(1, rms * 4));
}

export interface AsrDraftStreamHandle {
  /** 停止采音、冲掉缓冲、等服务端确认收尾，然后收线。 */
  stop: () => Promise<void>;
}

/**
 * 起一整条「采音 → WS → 草稿转录」。
 *
 * 失败一律以**具名**状态报出，绝不返回一个"看起来在录"的句柄——与 `live-asr.ts`/
 * `live-recording.ts` 同一条纪律。麦克风权限被拒绝、没有设备、浏览器不支持采音——
 * 这些都在 `startCapture()` 里已经有具名的 `LiveRecordingError`，这里原样透传，
 * 不重新发明第二套错误分类。
 */
export async function openAsrDraftStream(
  handlers: AsrDraftStreamHandlers,
  deps: {
    sessionToken?: string | null;
    capture?: () => Promise<CaptureHandle>;
    handshakeTimeoutMs?: number;
    /** 选中的输入设备（contract.md §7.1）；透传给 `startCapture`。空/未传 = 系统默认。 */
    deviceId?: string;
  } = {},
): Promise<AsrDraftStreamHandle> {
  const token = deps.sessionToken !== undefined ? deps.sessionToken : getStoredSessionToken();
  if (!token) throw new Error("a session token is required to open the ASR draft stream");

  const url = apiWebSocketUrl(STREAM.path);
  // bearer 走子协议，不走 query string——与 `live-asr.ts` 同一条理由（query 会进
  // access log / Referer / 浏览器历史）。
  const socket = new WebSocket(url, [`${STREAM.bearerSubprotocolPrefix}${token}`]);
  socket.binaryType = "arraybuffer";

  // #753 —— 握手只等 open/error 不够：反代把这条 WS 面路由错的时候，连接会安静地
  // 半开着，既不 open 也不 error，界面就会永远卡在"点了没反应"。加超时兜底，见
  // `api-client.ts` 的 `waitForSocketOpen` 头注。
  await waitForSocketOpen(
    socket,
    () => new Error("asr_draft_stream_handshake_failed"),
    deps.handshakeTimeoutMs,
  );

  // A terminal server event owns cleanup even if the UI has already discarded its handle.
  const capturePromise = Promise.resolve().then(() =>
    (deps.capture ?? (() => startCapture({ deviceId: deps.deviceId })))());
  let captureStopped: Promise<void> | null = null;
  const stopCapture = () => captureStopped ??= capturePromise.then((capture) => capture.stop());
  let terminal = false;
  let captureFailed = false;
  let stopRequested = false;
  let resolveTerminal!: () => void;
  const terminalDone = new Promise<void>((resolve) => { resolveTerminal = resolve; });
  const finish = (reason?: AsrDraftErrorReason) => {
    if (terminal) return;
    terminal = true;
    void stopCapture().catch(() => {
      reason ??= "ASR_PROVIDER_UNAVAILABLE";
    }).then(() => {
      socket.close();
      if (captureFailed) return;
      if (reason) handlers.onError(reason);
      else handlers.onFinished();
    }).finally(resolveTerminal);
  };

  socket.addEventListener("message", (event) => {
    if (terminal) return;
    const parsed = STREAM.server.safeParse(safeJson(String(event.data)));
    if (!parsed.success) return finish("ASR_PROVIDER_UNAVAILABLE");
    const frame = parsed.data;
    if (frame.type === "asr.partial") return handlers.onPartial(frame.text);
    if (frame.type === "asr.final") return handlers.onFinal(frame.text);
    if (frame.type === "asr.error") return finish(frame.reason);
    finish();
  });
  socket.addEventListener("close", () => finish(stopRequested ? undefined : "ASR_PROVIDER_UNAVAILABLE"));
  socket.addEventListener("error", () => finish("ASR_PROVIDER_UNAVAILABLE"));

  let capture: CaptureHandle;
  try {
    capture = await capturePromise;
  } catch (error) {
    captureFailed = true;
    terminal = true;
    socket.close();
    resolveTerminal();
    throw error;
  }
  if (terminal) {
    await terminalDone;
    throw new Error("asr_draft_stream_closed_during_capture_start");
  }
  socket.send(JSON.stringify({ type: "asr.start" }));
  capture.onFrame((frame) => {
    if (terminal) return;
    handlers.onLevel?.(pcm16Level(frame));
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
  });

  let stopping: Promise<void> | null = null;
  return {
    stop: () => stopping ??= (async () => {
      stopRequested = true;
      try {
        await stopCapture();
      } catch {
        finish("ASR_PROVIDER_UNAVAILABLE");
        await terminalDone;
        return;
      }
      if (!terminal && socket.readyState === WebSocket.OPEN) {
        // The terminal listener is installed before send, so even an immediate ACK is retained.
        socket.send(JSON.stringify({ type: "asr.finish" }));
      } else {
        finish();
      }
      await terminalDone;
    })(),
  };
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}
