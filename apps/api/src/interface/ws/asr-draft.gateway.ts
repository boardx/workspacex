/**
 * issue #726 —— `WS /chat/asr-draft`。composer 麦克风按钮的语音转录，**不落库**。
 *
 * 姊妹面是 `WS /recording/sessions/:sessionId/asr-stream`（issue #466，
 * `interface/ws/asr-stream.gateway.ts`）——两者复用**同一个** `AsrProviderPort`
 * （同一份服务端代理、同一把阿里云 key、同样"未配置就诚实报错"的纪律），但这条面
 * 刻意不做那条面做的两件事：
 *
 *   1. 不要求存在一个 `recording_sessions` 行 —— composer 麦克风此刻可能连一次录音
 *      会话都没有，用户只是想用语音代替打字。
 *   2. 不落库 —— `asr.final` 直接转发上游文本给发起请求的浏览器，不调
 *      `ingestTranscriptSegment`，不产生 `segmentId`。转录结果只活在浏览器的
 *      composer 草稿里，最终由用户编辑、手动点发送才成为一条真消息（那条写路径是
 *      `POST /chat/threads/:threadId/messages`，与这条面完全无关）。
 *
 * 契约见 `packages/contracts/src/chat.ts` 的 `streamOperations.streamAsrDraft`
 * ——那份文件头的注释解释了为什么这必须是独立的一条面而不是给 `streamAsr` 加个
 * 可选 sessionId。
 *
 * ## 鉴权
 *
 * 与 `asr-stream.gateway.ts` 相同的机制：bearer 走 `Sec-WebSocket-Protocol` 子协议
 * （浏览器的 `WebSocket` 构造器发不了自定义头，query string 会进 access log），
 * 用**同一个** `PrincipalResolverPort` 解析。
 *
 * ⚠ 这里**没有**项目角色 / 会话可见性判定 —— 草稿流不触碰任何项目或线程的数据，
 *   它是"我是谁"这一件事的门（登录即可用），不是"我对哪份数据有权限"。
 *   这与 `asr-stream.gateway.ts` 复用 `ingestSegment` 那条判定是刻意的不同：
 *   那条面写数据库，这条面不写。
 */
import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { chat as C } from "@repo/contracts";
import { AsrNotConfiguredError, type AsrProviderPort, type AsrSession } from "../../application/recording/asr-ports";
import type { PrincipalResolverPort } from "../../application/ports/principal-resolver.port";

type ServerFrame = typeof C.streamOperations.streamAsrDraft.server._type;
type AsrDraftErrorReason = typeof C.streamOperations.streamAsrDraft.err._type;

const PATH = C.streamOperations.streamAsrDraft.path;
const BEARER_PREFIX = C.streamOperations.streamAsrDraft.bearerSubprotocolPrefix;

export interface AsrDraftGatewayDeps {
  readonly principals: PrincipalResolverPort;
  readonly asr: AsrProviderPort;
}

/** 握手期的拒绝——在升级成 WebSocket 之前回 HTTP 状态码。见姊妹面同名函数的头注。 */
function refuseHandshake(socket: Duplex, status: number, reason: string): void {
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\n` +
    "Connection: close\r\n" +
    "Content-Length: 0\r\n\r\n",
  );
  socket.destroy();
}

export function attachAsrDraftGateway(server: Server, deps: AsrDraftGatewayDeps): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = request.url ?? "";
    // 精确路径匹配（不带 :sessionId 之类的动态段），允许尾随 query string。
    if (!(url === PATH || url.startsWith(`${PATH}?`))) return;

    void (async () => {
      const offered = String(request.headers["sec-websocket-protocol"] ?? "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      const bearer = offered.find((p) => p.startsWith(BEARER_PREFIX));
      if (bearer === undefined) return refuseHandshake(socket, 401, "Unauthorized");
      const token = bearer.slice(BEARER_PREFIX.length);

      let principal: Awaited<ReturnType<PrincipalResolverPort["resolve"]>>;
      try {
        principal = await deps.principals.resolve({ authorization: `Bearer ${token}` });
      } catch {
        return refuseHandshake(socket, 503, "Service Unavailable");
      }
      if (principal === null) return refuseHandshake(socket, 401, "Unauthorized");

      wss.handleUpgrade(request, socket, head, (ws) => serve(ws, deps));
    })().catch(() => refuseHandshake(socket, 500, "Internal Server Error"));
  });

  return wss;
}

function serve(ws: WebSocket, deps: AsrDraftGatewayDeps): void {
  const send = (frame: ServerFrame) => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(C.streamOperations.streamAsrDraft.server.parse(frame)));
  };

  let upstream: AsrSession | null = null;
  /** 与姊妹面相同的道理：`asr.start` 已收到，上游握手还没完成时到达的音频帧要缓存，不能丢、不能报错。 */
  let pendingAudio: Uint8Array[] | null = null;
  let pendingBytes = 0;

  const fail = (reason: AsrDraftErrorReason, detail: string): void => {
    process.stderr.write(`[asr-draft] ${reason}: ${detail}\n`);
    send({ type: "asr.error", reason });
    upstream?.abort();
    upstream = null;
    ws.close();
  };

  ws.on("message", (raw: Buffer, isBinary: boolean) => {
    if (isBinary) {
      if (upstream !== null) return upstream.pushAudio(raw);
      if (pendingAudio === null) return fail("AUDIO_FORMAT_REJECTED", "audio before asr.start");
      pendingBytes += raw.byteLength;
      if (pendingBytes > MAX_PENDING_AUDIO_BYTES) {
        return fail("ASR_PROVIDER_UNAVAILABLE", "upstream did not connect before the audio buffer filled");
      }
      pendingAudio.push(new Uint8Array(raw));
      return;
    }
    const parsed = C.streamOperations.streamAsrDraft.client.safeParse(safeJson(String(raw)));
    if (!parsed.success) return fail("AUDIO_FORMAT_REJECTED", "client frame failed contract validation");
    const frame = parsed.data;

    if (frame.type === "asr.start") {
      if (upstream !== null) return fail("ASR_PROVIDER_UNAVAILABLE", "asr.start sent twice");
      pendingAudio = [];
      void deps.asr.open({
        onPartial: (t) => send({ type: "asr.partial", text: t.text }),
        // 与姊妹面唯一的实质区别：final 不落库，直接转发。没有 segmentId 可给——
        // 这段文本从未成为数据库里的一行。
        onFinal: (t) => { if (t.text.trim() !== "") send({ type: "asr.final", text: t.text }); },
        onError: (reason, detail) => fail(asErrorReason(reason), detail),
        onClosed: () => { /* 收尾由 asr.finish 驱动 */ },
      }, C.streamOperations.streamAsrDraft.audio).then((session) => {
        for (const buffered of pendingAudio ?? []) session.pushAudio(buffered);
        pendingAudio = null;
        pendingBytes = 0;
        upstream = session;
      }).catch((e: unknown) => {
        if (e instanceof AsrNotConfiguredError) return fail("ASR_NOT_CONFIGURED", e.configHint);
        fail("ASR_PROVIDER_UNAVAILABLE", (e as Error).message);
      });
      return;
    }

    // asr.finish：冲上游，收到上游收尾后发 asr.finished，再关闭连接。没有落库队列要等——
    // 这正是这条面比姊妹面简单的地方。
    void (async () => {
      try {
        await upstream?.finish();
        send({ type: "asr.finished" });
      } catch (e) {
        fail("ASR_PROVIDER_UNAVAILABLE", (e as Error).message);
        return;
      }
      ws.close();
    })();
  });

  ws.on("close", () => { upstream?.abort(); upstream = null; });
}

/** 握手期音频缓存上限——与姊妹面相同的常数与理由（约 30 秒的 16kHz PCM16）。 */
const MAX_PENDING_AUDIO_BYTES = 16_000 * 2 * 30;

function asErrorReason(reason: string): AsrDraftErrorReason {
  const parsed = C.streamOperations.streamAsrDraft.err.safeParse(reason);
  return parsed.success ? parsed.data : "ASR_PROVIDER_UNAVAILABLE";
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}
