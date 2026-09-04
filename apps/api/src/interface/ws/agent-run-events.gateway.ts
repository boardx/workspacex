/**
 * Phase 14 F03 (`streaming-transport` 契约束 UC-1 `subscribeRunEvents`) -- `WS
 * /agent-runs/:runId/events`. The gateway's real-time replacement for polling
 * `GET /agent-runs/:runId` (see `wave2-runtime.ts`'s updated `operations` head comment):
 * every `KernelStreamEvent` `execute-run.ts`/`writeback.ts` publish onto the
 * `RunEventBusPort` (`run-event-bus.ts`) for this run is forwarded here the moment it
 * happens, not on the next poll tick.
 *
 * ## 鉴权与授权 -- 与 `GET /agent-runs/:runId` 同一条判定，不新开第二套
 *
 * 与本仓既有两条流式面（`asr-stream.gateway.ts`/`asr-draft.gateway.ts`）同一条既有原则。
 * bearer 走 `Sec-WebSocket-Protocol`（浏览器 `WebSocket` 构造器发不了自定义头，见那两个
 * 文件的头注）。可见性判定本身不在这个文件里——`checkRunVisible` 是一个注入的判断函数，
 * 生产合成（`main.ts` 的 `attachStreamingSurfaces`）把它接到 `read-run.ts` 的
 * `readAgentRun`（与 `GET /agent-runs/:runId` 逐字同一条判定，usecases.md UC-1 的
 * "pre: 调用者对该 run 可见（委托上游判定）"）。这个文件因此不需要知道
 * `resolveVisibility`/ACL 绑定/项目角色矩阵的任何细节，只需要知道"这次判断的结果是
 * 能看/不能看/判断本身失败"三种之一——这既是关注点分离，也让这个文件自己的测试
 * （连接、握手协议、按序转发、重连重放）不必重新搭一整套身份/权限夹具。
 *
 * ## `lastKnownSeq` 走 query string
 *
 * 它不是敏感信息（就是一个序号），不需要 `asr-stream.gateway.ts` 那条"令牌不能进
 * access log"的顾虑；放在 query string 上让"重连从哪里续"在握手那一刻就确定，不需要
 * 引入一个只用一次的 JSON "start" 帧协议。
 *
 * ## 六类事件按序、不丢不重复地转发（I-1/I-4），全部由 `RunEventBusPort` 保证
 *
 * `RunEventBusPort.subscribe` 自己的文档已经说明"重放缓冲区里 seq > afterSeq 的事件，
 * 再转实时"是一次调用做完的——这个文件只负责把那个回调的每一次调用序列化成一帧 WS
 * 消息，不在这里重新实现排序、去重或重放。
 */
import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { streamingTransport as ST } from "@repo/contracts";
import type { PrincipalResolverPort } from "../../application/ports/principal-resolver.port";
import type { RunEventBusPort } from "../../application/agent-run/run-event-bus";
import { AgentRunNotVisibleError, readAgentRun, type ReadAgentRunDeps } from "../../application/agent-run/read-run";
import { AuthzUnavailableError } from "../../application/chat/resolve-visibility";
import { toOrgId, type OrgId } from "../../domain/org-id";

/** Three outcomes, not a boolean: "unavailable" (a dependency failure, e.g. `AuthzUnavailableError`)
 * must answer 503, not the same 404 "not visible" answers -- collapsing them would turn a
 * transient outage into a false "this run doesn't exist" for every connecting client. */
export type RunVisibility = "visible" | "not_visible" | "unavailable";

const PATH_RE = /^\/agent-runs\/([^/?]+)\/events(?:\?|$)/;
/**
 * 与 `asr-draft.gateway.ts`/`asr-stream.gateway.ts` 同一个前缀字面量、同一种鉴权机制。
 * `streaming-transport.ts` 的签核材料未声明它，是因为 usecases.md UC-1 明确把握手层的
 * 具体协议留给实现（"WebSocket 订阅本身不返回传统 HTTP 错误码"）——这里延续本仓既有
 * 两条流式面已经用过的约定，不新造第三种。
 */
const BEARER_PREFIX = "bearer.";

export interface AgentRunEventsGatewayDeps {
  readonly principals: PrincipalResolverPort;
  /** 见文件头注 -- 生产合成把它接到 `readAgentRun`，测试可以直接注入一个假的判断。 */
  readonly checkRunVisible: (input: {
    readonly userId: string; readonly orgId: OrgId; readonly runId: string;
  }) => Promise<RunVisibility>;
  readonly events: RunEventBusPort;
}

/** 握手期的拒绝——在升级成 WebSocket 之前回 HTTP 状态码，同两条既有流式面的理由：
 * 建立连接后再发错误帧会让"你没权限"和"上游挂了"在客户端长得一模一样。 */
function refuseHandshake(socket: Duplex, status: number, reason: string): void {
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\n` +
    "Connection: close\r\n" +
    "Content-Length: 0\r\n\r\n",
  );
  socket.destroy();
}

export function attachAgentRunEventsGateway(
  server: Server,
  deps: AgentRunEventsGatewayDeps,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = request.url ?? "";
    const parsedUrl = new URL(url, "http://localhost");
    const match = PATH_RE.exec(parsedUrl.pathname);
    // 不是本面的路径 ⇒ 一个字都不写、一个字节都不动——本 HTTP server 上还有其它 WS 面
    // （asr 三条）共用同一次 `upgrade` 事件，抢答会把它们的连接吃掉。
    if (match === null) return;
    const runId = decodeURIComponent(match[1] ?? "");

    const lastKnownSeqRaw = parsedUrl.searchParams.get("lastKnownSeq");
    let lastKnownSeq: number | null = null;
    if (lastKnownSeqRaw !== null) {
      const parsed = Number(lastKnownSeqRaw);
      if (!Number.isInteger(parsed) || parsed < 0) return refuseHandshake(socket, 400, "Bad Request");
      lastKnownSeq = parsed;
    }

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

      const orgId = toOrgId(principal.orgId);
      let visibility: RunVisibility;
      try {
        visibility = await deps.checkRunVisible({ userId: principal.userId, orgId, runId });
      } catch {
        return refuseHandshake(socket, 500, "Internal Server Error");
      }
      if (visibility === "not_visible") return refuseHandshake(socket, 404, "Not Found");
      if (visibility === "unavailable") return refuseHandshake(socket, 503, "Service Unavailable");

      wss.handleUpgrade(request, socket, head, (ws) => {
        serve(ws, deps, orgId, runId, lastKnownSeq ?? -1);
      });
    })().catch(() => refuseHandshake(socket, 500, "Internal Server Error"));
  });

  return wss;
}

function serve(
  ws: WebSocket,
  deps: AgentRunEventsGatewayDeps,
  orgId: OrgId,
  runId: string,
  afterSeq: number,
): void {
  const unsubscribe = deps.events.subscribe(orgId, runId, afterSeq, (event) => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(ST.KernelStreamEvent.parse(event)));
  });
  ws.on("close", unsubscribe);
  ws.on("error", unsubscribe);
}

/**
 * Production `checkRunVisible` -- delegates to `readAgentRun` (`read-run.ts`), the SAME
 * function `GET /agent-runs/:runId` calls, so "who can see this run" never has two answers.
 * Kept as a tiny separate export (rather than inline in `main.ts`) so `main.ts` stays a
 * one-line wiring call, matching every other gateway's composition style.
 */
export function checkRunVisibleViaReadAgentRun(
  deps: ReadAgentRunDeps,
): AgentRunEventsGatewayDeps["checkRunVisible"] {
  return async ({ userId, orgId, runId }) => {
    try {
      await readAgentRun(deps, { userId, orgId, runId });
      return "visible";
    } catch (e) {
      if (e instanceof AgentRunNotVisibleError) return "not_visible";
      if (e instanceof AuthzUnavailableError) return "unavailable";
      throw e;
    }
  };
}
