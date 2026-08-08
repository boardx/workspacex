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
import { apiWebSocketUrl, getStoredSessionToken } from "./api-client";
import { startCapture, type CaptureHandle } from "./live-recording";

export type AsrDraftErrorReason = z.infer<typeof chat.ChatAsrDraftErrorReason>;

const STREAM = chat.streamOperations.streamAsrDraft;

export interface AsrDraftStreamHandlers {
  readonly onPartial: (text: string) => void;
  /** 与 `live-asr.ts` 的 `onFinal` 不同：这里没有 `segmentId`——这段文本从未落库。 */
  readonly onFinal: (text: string) => void;
  readonly onError: (reason: AsrDraftErrorReason) => void;
  readonly onFinished: () => void;
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
  deps: { sessionToken?: string | null; capture?: () => Promise<CaptureHandle> } = {},
): Promise<AsrDraftStreamHandle> {
  const token = deps.sessionToken !== undefined ? deps.sessionToken : getStoredSessionToken();
  if (!token) throw new Error("a session token is required to open the ASR draft stream");

  const url = apiWebSocketUrl(STREAM.path);
  // bearer 走子协议，不走 query string——与 `live-asr.ts` 同一条理由（query 会进
  // access log / Referer / 浏览器历史）。
  const socket = new WebSocket(url, [`${STREAM.bearerSubprotocolPrefix}${token}`]);
  socket.binaryType = "arraybuffer";

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("asr_draft_stream_handshake_failed")), { once: true });
  });

  socket.addEventListener("message", (event) => {
    const parsed = STREAM.server.safeParse(safeJson(String(event.data)));
    if (!parsed.success) return handlers.onError("ASR_PROVIDER_UNAVAILABLE");
    const frame = parsed.data;
    if (frame.type === "asr.partial") return handlers.onPartial(frame.text);
    if (frame.type === "asr.final") return handlers.onFinal(frame.text);
    if (frame.type === "asr.error") return handlers.onError(frame.reason);
    handlers.onFinished();
  });

  // 麦克风权限被拒绝 / 无设备 / 采音管线起不来——`startCapture` 抛 `LiveRecordingError`，
  // 这里让它原样冒泡给调用方（composer 据此渲染具名的中文提示，不静默失败）。
  // 采音失败时握手已建立的 WS 连接要关掉，不留着一条永远收不到音频的连接。
  let capture: CaptureHandle;
  try {
    capture = await (deps.capture ?? startCapture)();
  } catch (error) {
    socket.close();
    throw error;
  }

  socket.send(JSON.stringify({ type: "asr.start" }));
  capture.onFrame((frame) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
  });

  return {
    stop: async () => {
      await capture.stop();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "asr.finish" }));
        // 等服务端确认收尾（`asr.finished`）再收线——不等就关，最后一句可能还在
        // 上游的路上，提前挂断会让它悄悄消失。
        await new Promise<void>((resolve) => {
          socket.addEventListener("close", () => resolve(), { once: true });
          socket.addEventListener("message", (event) => {
            const parsed = STREAM.server.safeParse(safeJson(String(event.data)));
            if (parsed.success && parsed.data.type === "asr.finished") resolve();
          });
        });
      }
      socket.close();
    },
  };
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}
