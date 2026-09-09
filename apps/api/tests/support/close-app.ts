import type { INestApplication } from "@nestjs/common";
import type { Server } from "node:http";

/**
 * `await app.close()` 上的一条隐藏活性外包（2026-09-09，agui-bridge 30s 超时族的第二半）。
 *
 * Nest 的 `close()` 最终调 `httpServer.close()`，而 Node 的 `close()` **只停止接受新连接，
 * 不会掐断已建立的连接**——它等到最后一条连接自己走完。SSE 中继正是「连接开着、响应体
 * 还没结束」的形态：某条用例的 `fetch` 因为 vitest 30s 超时被放弃时，undici 那条 socket
 * 并没有被关掉，服务端仍在按中继预算继续轮询。于是 `afterAll` 等在那条 socket 上，直到
 * 撞上 `hookTimeout`，报 `Hook timed out in 120000ms`。
 *
 * 后果比慢严重得多：**一条卡住的用例把整个文件判红**，包括该文件里其余全部通过的用例——
 * 也正因为如此它每次都长得像抖动（重跑就全绿），从来没人查到底。
 *
 * 实测复现（本文件的修法落地前，一个「收下请求就再也不回」的上游替身）：
 *   × counterproof: a stalled upstream > must not hang the test  30109ms
 *     → Test timed out in 30000ms.
 *   FAIL ... [ agui-bridge-counterproof.test.ts ]
 *     Error: Hook timed out in 120000ms.
 *   Duration 157.42s   ← 30s（用例）+ 120s（钩子）
 *
 * `closeAllConnections()`（Node 18.2+）让收尾变成确定性的：先掐断连接，再关服务器。
 * 这不是把超时调大，是让 teardown 不再依赖别人的善意结束。
 */
export async function closeAppDeterministically(app: INestApplication | undefined): Promise<void> {
  if (!app) return;
  const server = app.getHttpServer() as Server & { closeAllConnections?: () => void };
  // 先掐断——顺序是关键：`close()` 之后再掐就已经在等了。
  server.closeAllConnections?.();
  await app.close();
}

/**
 * 同一条毛病的另一半，实测抓到的（见本文件上方的复现）：给 `app` 加了
 * `closeAllConnections()` 之后，`afterAll` **仍然**报 `Hook timed out in 120000ms`——
 * 因为卡住的连接不止一条。测试里的上游替身（loopback provider / deep-agent 替身 /
 * langgraph 替身）也是 `node:http` 服务器，API 进程发给它的那条请求还挂着，
 * `providerServer.close(cb)` 的回调就永远不来。
 *
 * 教训与 `close-app` 那半完全一样：**teardown 不能等别人自己结束**。每一个在
 * `beforeAll` 里 `listen()` 起来的服务器，收尾都要先掐连接再关。
 */
export async function closeHttpServerDeterministically(
  server: (Server & { closeAllConnections?: () => void }) | undefined,
): Promise<void> {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
