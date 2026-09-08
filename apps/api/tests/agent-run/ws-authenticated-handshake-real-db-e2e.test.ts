/**
 * issue #3073 第二轮 —— `wss://<host>/agent-runs/:runId/events` 在浏览器里报
 * `WebSocket is closed before the connection is established`。
 *
 * ## 这个文件补的是哪一段空白
 *
 * 既有两条 WS 测试（`ws-event-forwarding.test.ts` / `ws-latency-and-no-polling.test.ts`）
 * 用的是**假** `PrincipalResolverPort` 和**假** `checkRunVisible`——它们证明网关拿到判定
 * 结果之后做得对，不证明"真实 token + 真实 `readAgentRun`"这条**鉴权成功之后**的路径
 * 能不能在浏览器的握手预算内走完。#3073 的实测事实恰好夹在这一段里：
 *
 *   · 人类在 devapp 实测：未鉴权的 upgrade 探测，公网经 Caddy → 401，内网直连 API → 401。
 *     ⇒ 反代路由与网关的 upgrade 入口都通，401 是 `refuseHandshake` 在 upgrade 之前写的。
 *   · 浏览器里带真实 bearer 的连接却在 8 秒后被前端自己 `close()`
 *     （`apps/web/lib/api-client.ts` 的 `waitForSocketOpen`，#753），Chrome 因此逐字打出
 *     "closed before the connection is established"——即**鉴权之后**既没有 101，也没有
 *     任何 HTTP 拒绝码回来。
 *
 * 所以这条测试起**真实 `createApp()` + 真实 `app.listen()` + 真实
 * `attachStreamingSurfaces()`**（与 `main.ts` 生产进程入口逐字同一个顺序：先 listen 再
 * attach），用**真实登录换来的 session token**走子协议鉴权，断言：
 *
 *   V1 鉴权成功 + run 可见 ⇒ 8 秒内 101。预算直接取浏览器侧那个数
 *      （`WS_HANDSHAKE_TIMEOUT_MS`），不另编一个更宽松的"差不多"预算。
 *   V2 101 响应必须**回显** `Sec-WebSocket-Protocol`。客户端提了子协议而服务端一个都不
 *      选中，是一类会让浏览器拒绝握手的失败模式；本仓四条 WS 面全都依赖 `ws` 的默认
 *      选中行为，此前没有任何一条测试钉过这件事。
 *   V3 生产头形态（`Origin: https://devapp.boardx.us` + Caddy 会加的 `X-Forwarded-*`）
 *      不改变结果——网关里没有 origin 校验，这条把"没有"变成会红的东西。
 *   V4 鉴权成功但 run 不存在 ⇒ 8 秒内 404，**不是**静默半开。这条把 #3073 的现象
 *      （既不 101 也不拒绝）变成可判定的：鉴权之后的路径若会挂住，先在这里红。
 *
 * 真实 Postgres + 真实 Redis：session 存在 Redis 里、run 可见性判定要读真库，二者都不是
 * 内存假件能替的（同 `org-disabled-readonly.test.ts` /
 * `transcript-full-content-rbac.test.ts` 的既有先例）。
 */
import type { IncomingHttpHeaders } from "node:http";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { streamingTransport as ST } from "@repo/contracts";
import {
  addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";
import { seedAgentRun } from "../support/agent-run-db";
import { ensureRedis, resetCredentials, seedCredential } from "../support/auth";

process.env.KERNEL_QUIET = "1";

const ORG = "org-3073-ws-auth";
const PROJECT = "proj-3073-ws-auth";
const THREAD = "thread-3073-ws-auth";
const USER = "u-3073-ws-auth";
const DOMAIN = "issue3073ws.test";
const PASSWORD = "correct-horse-battery-staple";
const RUN_ID = "run-3073-ws-auth";

/** 浏览器侧的握手预算就是这个数（`apps/web/lib/api-client.ts` 的
 *  `WS_HANDSHAKE_TIMEOUT_MS`）。超过它，真实浏览器就会主动 close——也就复现成
 *  #3073 报的那句话。 */
const BROWSER_HANDSHAKE_BUDGET_MS = 8_000;
const BEARER_PREFIX = ST.operations.subscribeRunEvents.bearerSubprotocolPrefix;

let BASE = "";
let WS_BASE = "";
let app: NestExpressApplication;

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `${USER}@${DOMAIN}`, password: PASSWORD }),
  });
  const body = (await res.json()) as { sessionToken?: string };
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body.sessionToken as string;
}

type HandshakeOutcome =
  | { readonly kind: "open"; readonly elapsedMs: number; readonly headers: IncomingHttpHeaders }
  | { readonly kind: "refused"; readonly elapsedMs: number; readonly status: number }
  | { readonly kind: "no_answer"; readonly elapsedMs: number; readonly lastError: string | null };

/**
 * 一次真实的 WS 握手，按浏览器的口径判定：要么 101（`upgrade` 事件带响应头），要么一个
 * HTTP 拒绝码（`unexpected-response`），要么**在预算内什么都没有**（`no_answer`）。最后
 * 这一种正是 #3073 的现象——它在这里是一个显式的返回值，不是让测试挂到超时。
 */
function handshake(
  runId: string,
  token: string | null,
  headers: Record<string, string> = {},
): Promise<HandshakeOutcome> {
  const startedAt = Date.now();
  const protocols = token === null ? [] : [`${BEARER_PREFIX}${token}`];
  const ws = new WebSocket(
    `${WS_BASE}/agent-runs/${encodeURIComponent(runId)}/events`,
    protocols,
    { headers },
  );
  return new Promise<HandshakeOutcome>((resolve) => {
    let lastError: string | null = null;
    let settled = false;
    const settle = (outcome: HandshakeOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.removeAllListeners();
      // ⚠ `terminate()` 在 CONNECTING 阶段会抛 "WebSocket was closed before the
      // connection was established"（`ws` 自己的 `websocket.js`）——与 #3073 里浏览器
      // 打的那句同源。这里必须挂一个空的 error 监听并吞掉它，否则清理动作自己会
      // 变成一次未捕获异常，把测试结果染红。
      ws.on("error", () => {});
      try { ws.terminate(); } catch { /* 见上 */ }
      resolve(outcome);
    };
    const timer = setTimeout(
      () => settle({ kind: "no_answer", elapsedMs: Date.now() - startedAt, lastError }),
      BROWSER_HANDSHAKE_BUDGET_MS,
    );
    ws.on("upgrade", (res) =>
      settle({ kind: "open", elapsedMs: Date.now() - startedAt, headers: res.headers }));
    ws.on("unexpected-response", (_req, res) =>
      settle({ kind: "refused", elapsedMs: Date.now() - startedAt, status: res.statusCode ?? 0 }));
    // `error` 不带状态码。记下来交给超时分支一起报，不把"连接层报错"和"服务端给了答复"
    // 混成同一种结果。
    ws.on("error", (e: Error) => { lastError = e.message; });
  });
}

beforeAll(async () => {
  ensureDatabase();
  ensureRedis();
  await migrateOnce();
  const { createApp, attachStreamingSurfaces } = await import("../../src/main");
  app = await createApp();
  // ⚠ 必须绑回环：下面 BASE/WS_BASE 都指向 127.0.0.1，而裸 `listen(0)` 绑的是 0.0.0.0——
  //   抽到的临时端口可能已被别的进程占在 127.0.0.1 上，请求就打到那个进程去了（issue #2992，
  //   机械门 `lint-test-listen-loopback`）。bind 哪个地址就 fetch 哪个地址，冲突当场 EADDRINUSE。
  await app.listen(0, "127.0.0.1");
  // 与 `main.ts` 的生产进程入口逐字同一个顺序（先 listen 再 attach）——WS 面挂在同一个
  // HTTP server 的 `upgrade` 事件上，顺序换了这条测试就不是在测生产装配。
  attachStreamingSurfaces(app);
  const addr = app.getHttpServer().address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  BASE = `http://127.0.0.1:${port}`;
  WS_BASE = `ws://127.0.0.1:${port}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await resetCredentials([USER], [`${USER}@${DOMAIN}`]);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, USER, "admin", null);
  // `readAgentRun` 走 `resolveVisibility`：plenary 线程要的是**项目**成员资格，
  // org 角色不够（这正是它与 `getRunTranscript` 那条 RBAC 判定的区别）。
  await addProjectMember(ORG, PROJECT, USER, "facilitator", null);
  await seedCredential({ userId: USER, email: `${USER}@${DOMAIN}`, password: PASSWORD });
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: USER,
  });
  await seedAgentRun({ orgId: ORG, id: RUN_ID, threadId: THREAD, authorId: USER, status: "running" });
});

describe("#3073 —— 鉴权成功之后，真实装配下的握手必须在浏览器预算内有结果", () => {
  it("V1/V2: 真实 token + 可见 run ⇒ 8 秒内 101，且回显客户端提的子协议", async () => {
    const token = await login();
    const outcome = await handshake(RUN_ID, token);
    expect(outcome.kind, JSON.stringify(outcome)).toBe("open");
    if (outcome.kind !== "open") return;
    expect(outcome.elapsedMs).toBeLessThan(BROWSER_HANDSHAKE_BUDGET_MS);
    // V2：客户端提了子协议，服务端必须选中一个并回显——不选中是浏览器会拒绝握手的一类。
    expect(outcome.headers["sec-websocket-protocol"]).toBe(`${BEARER_PREFIX}${token}`);
  }, 60_000);

  it("V3: 生产头形态（Origin=https://devapp.boardx.us + Caddy 的 X-Forwarded-*）不改变结果", async () => {
    const token = await login();
    const outcome = await handshake(RUN_ID, token, {
      origin: "https://devapp.boardx.us",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "devapp.boardx.us",
      "x-forwarded-for": "203.0.113.7",
    });
    expect(outcome.kind, JSON.stringify(outcome)).toBe("open");
  }, 60_000);

  it("V4: 真实 token + 不存在的 run ⇒ 8 秒内 404，不是静默半开（#3073 的现象）", async () => {
    const token = await login();
    const outcome = await handshake("run-does-not-exist-3073", token);
    expect(outcome.kind, JSON.stringify(outcome)).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.status).toBe(404);
  }, 60_000);

  it("对照：无 token ⇒ 401（与人类在 devapp 上实测到的那一条同一个答复）", async () => {
    const outcome = await handshake(RUN_ID, null);
    expect(outcome.kind, JSON.stringify(outcome)).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.status).toBe(401);
  }, 60_000);
});
