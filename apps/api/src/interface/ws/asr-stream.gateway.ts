/**
 * issue #466 —— `WS /recording/sessions/:sessionId/asr-stream`。
 *
 * 本仓的**第一条流式面**。签核见
 * `phases/phase-01-run-a-project/design-deltas/realtime-asr/design-signoff.md`。
 *
 * ## 它做的四件事，和它坚决不做的一件事
 *
 *   1. 握手鉴权 —— 与 HTTP 面**同一个** `PrincipalResolverPort`。
 *   2. 授权 —— 与 `ingestSegment` **同一条判定**（项目角色 + 会话存在于本租户）。
 *      不新增授权口径；无权即在握手阶段拒绝，**不建立连接**。
 *   3. 把 PCM16 转发给 ASR 提供方。
 *   4. 收到 `final` 时**先落库、后回帧**。
 *
 * 它**不**自己写数据库。落库唯一走 `interface/recording/segment-ingestion.ts` 的
 * `ingestTranscriptSegment`，也就是 HTTP `POST /recording/sessions/:id/segments`
 * 用的同一个函数（contract.md §2：「不新增第二条写路径」）。
 *
 * ## 为什么 bearer 走子协议而不是 query string
 *
 * 浏览器的 `WebSocket` 构造器发不了自定义头。剩下两条路：
 *   · query string —— 会话令牌会进 access log、进 Referer、进浏览器历史。**出局。**
 *   · `Sec-WebSocket-Protocol` —— 标准字段，握手时发送，不进 URL。**选它。**
 * 前缀字面量在契约里（`streamOperations.streamAsr.bearerSubprotocolPrefix`），
 * 服务端与浏览器各自从那里取，不各写一份。
 *
 * ## 为什么先落库后回帧
 *
 * 反过来（先回帧再落库）会让界面上出现一段**数据库里没有**的转录 ——
 * 刷新一次它就消失了。本仓步骤 6a / 8a 的注释里已经把这种失败写清楚了：
 * 「刷新后仍在」是唯一能区分「写进了 PostgreSQL」与「写进了 React state」的断言。
 * 这个顺序就是让那条断言有意义的东西。
 */
import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { recording as C } from "@repo/contracts";
import {
  AsrNotConfiguredError,
  type AsrProviderPort,
  type AsrSession,
} from "../../application/recording/asr-ports";
import type { PrincipalResolverPort } from "../../application/ports/principal-resolver.port";
import type { IdentityRepository } from "../../application/identity/ports";
import type {
  RecordingUnitOfWork,
  TranscriptionPolicyProvider,
} from "../../application/recording/session-lifecycle-ports";
import type { IdGenerator } from "../../application/recording/ports";
import { toOrgId } from "../../domain/org-id";
import { RecordingRefusal, ingestTranscriptSegment } from "../recording/segment-ingestion";

type ServerFrame = typeof C.streamOperations.streamAsr.server._type;
type AsrErrorReason = typeof C.streamOperations.streamAsr.err._type;

const PATH_RE = /^\/recording\/sessions\/([^/?]+)\/asr-stream(?:\?|$)/;
const BEARER_PREFIX = C.streamOperations.streamAsr.bearerSubprotocolPrefix;

export interface AsrGatewayDeps {
  readonly principals: PrincipalResolverPort;
  readonly identities: IdentityRepository;
  readonly uow: RecordingUnitOfWork;
  readonly policies: TranscriptionPolicyProvider;
  readonly ids: IdGenerator;
  readonly asr: AsrProviderPort;
}

/**
 * 握手期的拒绝。**在升级成 WebSocket 之前**回 HTTP 状态码 —— 建立连接再发一帧
 * `asr.error` 然后关掉，会让「你没权限」和「上游挂了」在客户端长得一模一样。
 */
function refuseHandshake(socket: Duplex, status: number, reason: string): void {
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\n` +
    "Connection: close\r\n" +
    "Content-Length: 0\r\n\r\n",
  );
  socket.destroy();
}

export function attachAsrGateway(server: Server, deps: AsrGatewayDeps): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = request.url ?? "";
    const match = PATH_RE.exec(url);
    // 不是本面的路径 ⇒ 一个字都不写、一个字节都不动。别的 upgrade 监听者（今天没有）
    // 还要用这条连接，抢答会把它们的连接吃掉。
    if (match === null) return;
    const sessionId = decodeURIComponent(match[1] ?? "");

    void (async () => {
      // 子协议里的 bearer → 伪造一个 `authorization` 头交给**同一个**解析器。
      // 不在这里自己解 token：那会是第二份「什么算有效会话」的判定。
      const offered = String(request.headers["sec-websocket-protocol"] ?? "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      const bearer = offered.find((p) => p.startsWith(BEARER_PREFIX));
      if (bearer === undefined) return refuseHandshake(socket, 401, "Unauthorized");
      const token = bearer.slice(BEARER_PREFIX.length);

      let principal: Awaited<ReturnType<PrincipalResolverPort["resolve"]>>;
      try {
        principal = await deps.principals.resolve({ authorization: `Bearer ${token}` });
      } catch {
        // 会话存储挂了 ⇒ 503，与 HTTP Guard 的 `auth_unavailable` 同义。
        // 答 401 会让用户去重新登录，而登录也会失败。
        return refuseHandshake(socket, 503, "Service Unavailable");
      }
      if (principal === null) return refuseHandshake(socket, 401, "Unauthorized");

      const orgId = toOrgId(principal.orgId);
      // 授权与 `ingestSegment` 同一条：会话必须在本租户存在、且未结束、且我在该项目里有角色。
      const gate = await deps.uow.withOrg(orgId, { userId: principal.userId }, async (stores) => {
        const session = await stores.sessions.lifecycleSession(sessionId);
        // 另一个租户的 sessionId 与不存在的 sessionId 答案完全相同 ——
        // 与四条 HTTP 路由同一条规矩，这个端点不是 id 神谕。
        if (session === undefined) return { ok: false as const, status: 404 };
        if (session.endedAt !== null) return { ok: false as const, status: 409 };
        const membership = await deps.identities.findProjectMembership(
          principal.userId, session.projectId, orgId,
        );
        if (membership === null) return { ok: false as const, status: 403 };
        return { ok: true as const, projectId: session.projectId };
      });
      if (!gate.ok) return refuseHandshake(socket, gate.status, "Refused");

      wss.handleUpgrade(request, socket, head, (ws) => {
        // 回选子协议：浏览器要求服务端从它 offer 的列表里选一个，否则连接被客户端拒绝。
        serve(ws, deps, { userId: principal.userId, orgId }, sessionId);
      });
    })().catch(() => refuseHandshake(socket, 500, "Internal Server Error"));
  });

  return wss;
}

function serve(
  ws: WebSocket,
  deps: AsrGatewayDeps,
  principal: { userId: string; orgId: ReturnType<typeof toOrgId> },
  sessionId: string,
): void {
  const send = (frame: ServerFrame) => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(C.streamOperations.streamAsr.server.parse(frame)));
  };

  let upstream: AsrSession | null = null;
  let trackId: string | null = null;
  let keyPrefix: string | null = null;
  let sequence = 0;
  /** 落库串行化：两段 final 同时进来会抢同一个序号，进而抢同一个幂等键。 */
  let writeChain: Promise<unknown> = Promise.resolve();
  const startedAt = Date.now();

  const fail = (reason: AsrErrorReason, detail: string): void => {
    // detail 只进服务端日志。上游的错误文本可能带着我们不该转发的东西。
    process.stderr.write(`[asr] session=${sessionId} ${reason}: ${detail}\n`);
    send({ type: "asr.error", reason });
    upstream?.abort();
    upstream = null;
    ws.close();
  };

  const persist = (text: string, confidence: number | null): void => {
    if (trackId === null || keyPrefix === null) return;
    const track = trackId;
    const prefix = keyPrefix;
    const ordinal = (sequence += 1);
    const elapsed = Date.now() - startedAt;
    writeChain = writeChain.then(async () => {
      try {
        const outcome = await ingestTranscriptSegment(
          { uow: deps.uow, identities: deps.identities, policies: deps.policies, ids: deps.ids },
          principal, principal.orgId, sessionId,
          {
            sessionId,
            trackId: track,
            // 锚点用**挂断为止的墙钟毫秒**。这不是精确的音频时间轴（那需要上游回时间戳，
            // 它今天不回），但它是单调的、可复现的，且 `ANCHOR_MISSING` 要的就是
            // 「这段话在这场录音里的位置说得出来」。上游开始回时间戳时换掉它。
            anchor: { startMs: Math.max(0, elapsed - 1), endMs: elapsed, messageId: null },
            rawText: text,
            // 上游没给置信度时传 0 会**捏造一个低置信度**，传 1 会捏造一个高的。
            // 契约要求一个 number，所以这里传上游给的那个；没有就用策略层的中性值。
            asrConfidence: confidence ?? NEUTRAL_CONFIDENCE,
            diarization: { channelId: null, overlap: false },
            // 幂等键 = 前缀 + 序号（contract.md §2）。重连重放同一段不会写第二条。
            idempotencyKey: `${prefix}-${ordinal}`,
          },
        );
        send({
          type: "asr.final",
          segmentId: outcome.result.segmentId,
          text: outcome.result.text,
          lowConfidence: outcome.result.lowConfidence,
        });
      } catch (e) {
        if (e instanceof RecordingRefusal) {
          const reason = e.reason === "SESSION_ENDED" || e.reason === "NO_PROJECT_ROLE"
            ? e.reason
            : "ASR_PROVIDER_UNAVAILABLE";
          fail(reason, `ingest refused: ${e.reason}`);
          return;
        }
        fail("ASR_PROVIDER_UNAVAILABLE", `ingest failed: ${(e as Error).message}`);
      }
    });
  };

  ws.on("message", (raw: Buffer, isBinary: boolean) => {
    if (isBinary) {
      if (upstream === null) return fail("ASR_PROVIDER_UNAVAILABLE", "audio before asr.start");
      upstream.pushAudio(raw);
      return;
    }
    const parsed = C.streamOperations.streamAsr.client.safeParse(safeJson(String(raw)));
    if (!parsed.success) return fail("AUDIO_FORMAT_REJECTED", "client frame failed contract validation");
    const frame = parsed.data;

    if (frame.type === "asr.start") {
      if (upstream !== null) return fail("ASR_PROVIDER_UNAVAILABLE", "asr.start sent twice");
      trackId = frame.trackId;
      keyPrefix = frame.idempotencyKeyPrefix;
      void deps.asr.open({
        onPartial: (t) => send({ type: "asr.partial", text: t.text }),
        onFinal: (t) => { if (t.text.trim() !== "") persist(t.text, t.confidence); },
        // 适配器只允许交出契约里有的码；不是的话当场变成 `ASR_PROVIDER_UNAVAILABLE`，
        // 而不是把一个界面认不出来的字符串转发给浏览器。
        onError: (reason, detail) => fail(asErrorReason(reason), detail),
        onClosed: () => { /* 收尾由 asr.finish 驱动，这里不抢着关客户端连接 */ },
      }, C.streamOperations.streamAsr.audio).then((session) => {
        upstream = session;
      }).catch((e: unknown) => {
        if (e instanceof AsrNotConfiguredError) {
          // 诚实降级：界面显示「未配置转写」，**不是**静默失败、**不是**换个提供方。
          return fail("ASR_NOT_CONFIGURED", e.message);
        }
        fail("ASR_PROVIDER_UNAVAILABLE", (e as Error).message);
      });
      return;
    }
    if (frame.type === "asr.commit") {
      upstream?.commit();
      return;
    }
    // asr.finish：冲上游 → 等落库队列排空 → 才发 asr.finished。
    // 抢在落库之前发 finished，客户端就会在数据还没进库时刷新页面，
    // 然后看见空转录并以为功能坏了。
    void (async () => {
      try {
        await upstream?.finish();
        await writeChain;
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

function asErrorReason(reason: string): AsrErrorReason {
  const parsed = C.streamOperations.streamAsr.err.safeParse(reason);
  return parsed.success ? parsed.data : "ASR_PROVIDER_UNAVAILABLE";
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * 上游没给置信度时用的中性值。
 *
 * ⚠ 它**不是**「高置信度」的意思。低置信度的判据在 `TranscriptionPolicy.isLowConfidence`
 *   里（阈值 `[待定 D-1]`，由 `KERNEL_TRANSCRIPTION_LOW_CONFIDENCE_THRESHOLD` 配置），
 *   这里只是在契约要求一个 number 而上游没给时，交出一个**不会替策略层做决定**的值：
 *   0 会捏造「这段很可疑」，1 会捏造「这段很可靠」，两个都是在替人拍板。
 *   上游开始回置信度后，这个常量就不再被走到。
 */
const NEUTRAL_CONFIDENCE = Number(process.env.KERNEL_ASR_NEUTRAL_CONFIDENCE ?? 0.5);
