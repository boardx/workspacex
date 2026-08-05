/**
 * live-asr.ts —— #466 步骤 7 的第二段：把采到的音频送上服务端 WS 面，把转录取回来。
 *
 * 第一段（真实采音 → PCM16/16k/单声道）在 `live-recording.ts`；本文件不重复它。
 * 设计签核见 `phases/phase-01-run-a-project/design-deltas/realtime-asr/`。
 *
 * ## 这个文件不认识任何 ASR 厂商
 *
 * 它只认识本仓自己的那条 WS 面。上游是谁、key 是什么，浏览器**永远不知道** ——
 * 那是这条面必须是服务端代理的全部理由（contract.md 决策段）。
 *
 * ## 转录不是从这里「生出来」的
 *
 * `asr.final` 帧里的 `segmentId` 由服务端 `ingestSegment` **落库后**才发出来。
 * 所以界面上显示的每一段转录，在 PostgreSQL 里都有对应的一行 —— 这不是承诺，
 * 是帧顺序的结果（见网关文件头「为什么先落库后回帧」）。
 *
 * ⚠ 界面**不得**自己调 `POST /recording/sessions/:id/segments` 写 ASR 结果。
 *   那会是同一事实的第二条写路径，contract.md §2 逐字禁止。本文件因此
 *   **没有**任何往 `/segments` 发 POST 的代码；它只 GET 读回。
 */
import { recording } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest, apiWebSocketUrl, getStoredSessionToken } from "./api-client";
import { startCapture, type CaptureHandle } from "./live-recording";

export type StartRecordingOut = z.infer<typeof recording.operations.startRecording.out>;
export type ReadTranscriptOut = z.infer<typeof recording.operations.readTranscriptStream.out>;
export type TranscriptSegment = z.infer<typeof recording.Segment>;
export type AsrStreamErrorReason = z.infer<typeof recording.AsrStreamErrorReason>;

const OPS = recording.operations;
const STREAM = recording.streamOperations.streamAsr;

function sessionPath(path: string, sessionId: string): string {
  return path.replace(":sessionId", encodeURIComponent(sessionId));
}

/**
 * 开一场绑定到本会话线程的录音。
 *
 * `sourceType: "thread"` + `sourceRefId: threadId` —— 这两个字段就是「转录归属该会话」
 * 的**落点**。`recording_sessions` 上有 `(org_id, source_ref_id) WHERE ended_at IS NULL`
 * 的唯一索引，所以同一条线程同时只可能有一场在录，不需要前端再自己防重。
 */
export async function startThreadRecording(
  threadId: string,
  projectId: string,
  participantId: string,
  sessionToken?: string,
): Promise<StartRecordingOut> {
  return apiRequest<StartRecordingOut>(OPS.startRecording.path, {
    method: "POST",
    body: {
      sourceType: "thread",
      sourceRefId: threadId,
      projectId,
      trackPlan: [{ participantId }],
      idempotencyKey: `rec-start-${threadId}-${Date.now()}`,
    },
    sessionToken,
  });
}

export async function endThreadRecording(
  sessionId: string,
  sessionToken?: string,
): Promise<void> {
  await apiRequest(sessionPath(OPS.endRecording.path, sessionId), {
    method: "POST",
    body: { sessionId, idempotencyKey: `rec-end-${sessionId}` },
    sessionToken,
  });
}

/**
 * 读回本场录音的转写段。**这是「刷新后仍在」那条断言的数据来源** ——
 * 它打的是 PostgreSQL，不是任何前端缓存。
 */
export async function readTranscript(
  sessionId: string,
  sessionToken?: string,
): Promise<ReadTranscriptOut> {
  return apiRequest<ReadTranscriptOut>(sessionPath(OPS.readTranscriptStream.path, sessionId), {
    method: "GET",
    // 契约的 `includeMasked` 是 `z.literal(true)`：本端口不提供未遮盖读取。
    query: { includeMasked: "true" },
    sessionToken,
  });
}

export interface AsrStreamHandlers {
  readonly onPartial: (text: string) => void;
  /** 落库之后才会被调用；`segmentId` 是数据库里那一行的 id。 */
  readonly onFinal: (segment: { segmentId: string; text: string; lowConfidence: boolean }) => void;
  readonly onError: (reason: AsrStreamErrorReason) => void;
  readonly onFinished: () => void;
}

export interface AsrStreamHandle {
  /** 停止采音、冲掉缓冲、等服务端把最后一段落库，然后收线。 */
  stop: () => Promise<void>;
}

/**
 * 起一整条「采音 → WS → 转录」。
 *
 * 失败一律以**具名**状态报出，绝不返回一个「看起来在录」的句柄 ——
 * 假装在录是这类功能最坏的失败方式（同 `live-recording.ts` 的纪律）。
 */
export async function openAsrStream(
  sessionId: string,
  trackId: string,
  /**
   * 转录挂靠的那条消息。
   *
   * ⚠ 不是可选参数：`thread` 载体的段落**必须**锚在一条消息上（已签 recording 束
   *   的 I-1）。给一个默认值等于让「锚点丢了」在编译期消失、到运行时才以
   *   `ANCHOR_MISSING` 的形式出现 —— 实测就是这么红了一次。
   */
  messageId: string,
  handlers: AsrStreamHandlers,
  deps: { sessionToken?: string | null; capture?: () => Promise<CaptureHandle> } = {},
): Promise<AsrStreamHandle> {
  const token = deps.sessionToken !== undefined ? deps.sessionToken : getStoredSessionToken();
  if (!token) throw new Error("a session token is required to open the ASR stream");

  const url = apiWebSocketUrl(sessionPath(STREAM.path, sessionId));
  // bearer 走子协议，不走 query string —— query 会进 access log / Referer / 浏览器历史。
  // 前缀字面量取自契约，两端不各写一份。
  const socket = new WebSocket(url, [`${STREAM.bearerSubprotocolPrefix}${token}`]);
  socket.binaryType = "arraybuffer";

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    // 握手被拒（401/403/404/409）在浏览器里只表现为一个无信息的 `error` 事件 ——
    // 这是浏览器的限制，不是我们省事。所以服务端把判定放在握手阶段，
    // 而界面把它说成「无法开始转写」，不编一个它并不知道的具体原因。
    socket.addEventListener("error", () => reject(new Error("asr_stream_handshake_failed")), { once: true });
  });

  socket.addEventListener("message", (event) => {
    const parsed = STREAM.server.safeParse(safeJson(String(event.data)));
    // 认不出来的帧**报错**，不猜。猜一个语义出来就是在编造转录。
    if (!parsed.success) return handlers.onError("ASR_PROVIDER_UNAVAILABLE");
    const frame = parsed.data;
    if (frame.type === "asr.partial") return handlers.onPartial(frame.text);
    if (frame.type === "asr.final") {
      return handlers.onFinal({
        segmentId: frame.segmentId, text: frame.text, lowConfidence: frame.lowConfidence,
      });
    }
    if (frame.type === "asr.error") return handlers.onError(frame.reason);
    handlers.onFinished();
  });

  const capture = await (deps.capture ?? startCapture)();
  socket.send(JSON.stringify({
    type: "asr.start",
    trackId,
    messageId,
    // 幂等键前缀。带 sessionId 与时间戳：重连后重放同一段不会写第二条（contract.md §2）。
    idempotencyKeyPrefix: `asr-${sessionId}-${Date.now()}`,
  }));
  capture.onFrame((frame) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    // 裸 PCM16 二进制帧，格式由契约 `ASR_AUDIO_FORMAT` 定义。
    socket.send(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
  });

  return {
    stop: async () => {
      await capture.stop();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "asr.finish" }));
        // 等服务端把最后一段落库后发 `asr.finished` 再收线。不等就关，
        // 最后一句话会在界面上消失，而那种丢失长得像「录音没生效」。
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
