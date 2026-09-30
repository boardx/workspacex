#!/usr/bin/env node
/**
 * #4789 —— 确定性的**出站邮件上游**（Cloudflare Email Sending REST 形状），让 e2e 能观察产品发了什么邮件。
 *
 * ## 这不是 mock fallback，区别与 `loopback-asr-provider.ts` 逐条同型
 *
 *   · 必须被**显式选中**：两个 transport（`CloudflareEmailTransport` / `CloudflareTransactionalEmailTransport`）
 *     只认 `CLOUDFLARE_API_BASE_URL` 这一个变量（`infrastructure/cloudflare-email-api-base.ts`），
 *     未设 ⇒ 官方地址；**生产环境禁止覆盖**（抛错）。不存在「悄悄退回到它」的路径。
 *   · 不在产品代码里：被测的是**真实 transport**走**真实 HTTP**，只是上游换成可观察的本地进程。
 *   · 缺席时没人兜底：不起本进程，发信以 `network` 诚实失败。
 *
 * ## 它模仿的请求/响应形状（逐字取自两个 transport 与它们的测试）
 *
 *   POST {base}/accounts/{accountId}/email/sending/send
 *     header  authorization: Bearer <token>   ← 必须是 LOOPBACK_MAIL_ACCEPTED_TOKENS 之一，否则 401
 *             content-type: application/json
 *     body    { from: { address }, to: string | string[], subject, text, html, headers? }
 *   200 { success: true, errors: [], messages: [],
 *         result: { delivered: [to...], permanent_bounces: [], queued: [] } }
 *       ↑ 验证邮件 transport 要求 `result.delivered/queued/permanent_bounces` 都是数组且收件人恰好出现一次；
 *         事务邮件 transport 只看 `success === true`。两者都满足。
 *
 * ## 观察/控制面（仅本替身有，产品不知道它们）
 *
 *   GET    /healthz                          → { ok: true }
 *   GET    /__messages?to=<email>&since=<iso> → { messages: Message[] }（按接收时间升序；to 大小写不敏感）
 *   DELETE /__messages                       → 清空已记录邮件与计数
 *   GET    /__stats                          → { accepted, rejected, timedOut, unauthorized, fault }
 *   POST   /__fault { mode: "none"|"reject"|"timeout", to?: string }
 *            作用于**之后**的发送；带 `to` 时只影响发给该地址的邮件（并行 spec 互不干扰）。
 *            reject  ⇒ 真实 Cloudflare 风格的 503 错误 JSON，不记录邮件
 *            timeout ⇒ 挂住 LOOPBACK_MAIL_TIMEOUT_DELAY_MS（须大于 transport 的 10s 超时）后断开，不记录邮件
 *
 * ## 环境变量（全部必填，缺即抛，不猜默认值）
 *   LOOPBACK_MAIL_PROVIDER_PORT         监听端口
 *   LOOPBACK_MAIL_ACCOUNT_ID            期望的 accountId（路径里不符 ⇒ 404，抓 accountId 接线错误）
 *   LOOPBACK_MAIL_ACCEPTED_TOKENS       逗号分隔的可接受 bearer token
 *   LOOPBACK_MAIL_TIMEOUT_DELAY_MS      可选，默认 15000
 *
 * ⚠ 常量的唯一事实源是 `apps/web/e2e/fullstack-smoke-fixture.ts` 的 `MAIL_LOOPBACK`，
 *   由 playwright config 同时下发给本进程、API 进程与断言方。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const port = Number(process.env.LOOPBACK_MAIL_PROVIDER_PORT ?? "");
if (!Number.isInteger(port) || port <= 0) {
  throw new Error("LOOPBACK_MAIL_PROVIDER_PORT must be a positive integer");
}
const ACCOUNT_ID = process.env.LOOPBACK_MAIL_ACCOUNT_ID;
if (!ACCOUNT_ID) throw new Error("LOOPBACK_MAIL_ACCOUNT_ID is required");
const ACCEPTED_TOKENS = new Set(
  (process.env.LOOPBACK_MAIL_ACCEPTED_TOKENS ?? "").split(",").map((t) => t.trim()).filter(Boolean),
);
if (ACCEPTED_TOKENS.size === 0) throw new Error("LOOPBACK_MAIL_ACCEPTED_TOKENS is required");
const TIMEOUT_DELAY_MS = Number(process.env.LOOPBACK_MAIL_TIMEOUT_DELAY_MS ?? "15000");

const SEND_PATH = `/client/v4/accounts/${encodeURIComponent(ACCOUNT_ID)}/email/sending/send`;

type FaultMode = "none" | "reject" | "timeout";
interface RecordedMail {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly receivedAt: string;
  readonly headers: Record<string, string>;
}

const mailbox: RecordedMail[] = [];
const counters = { accepted: 0, rejected: 0, timedOut: 0, unauthorized: 0 };
let fault: { mode: FaultMode; to: string | null } = { mode: "none", to: null };

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** 与真实 Cloudflare v4 错误信封同形：`{ success:false, errors:[{code,message}], messages:[], result:null }`。 */
function cfError(res: ServerResponse, status: number, code: number, message: string): void {
  json(res, status, { success: false, errors: [{ code, message }], messages: [], result: null });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => { text += chunk; });
    req.on("end", () => resolve(text));
    req.on("error", reject);
  });
}

function recipients(to: unknown): string[] | null {
  if (typeof to === "string" && to.length > 0) return [to];
  if (Array.isArray(to) && to.length > 0 && to.every((t) => typeof t === "string" && t.length > 0)) return to as string[];
  return null;
}

function faultApplies(to: string[]): boolean {
  if (fault.mode === "none") return false;
  if (fault.to === null) return true;
  return to.some((t) => t.toLowerCase() === fault.to);
}

async function handleSend(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = req.headers.authorization ?? "";
  const match = /^Bearer (.+)$/.exec(auth);
  if (!match || !ACCEPTED_TOKENS.has(match[1]!)) {
    counters.unauthorized += 1;
    cfError(res, 401, 10000, "Authentication error");
    return;
  }
  if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    cfError(res, 400, 10001, "content-type must be application/json");
    return;
  }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(await readBody(req));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    cfError(res, 400, 10001, "request body is not valid JSON");
    return;
  }
  const from = (body.from as { address?: unknown } | undefined)?.address;
  const to = recipients(body.to);
  const { subject, text, html } = body;
  if (typeof from !== "string" || from.length === 0 || to === null
    || typeof subject !== "string" || typeof text !== "string" || typeof html !== "string") {
    // 真实 API 对缺字段同样 400；这里逐项要求 transport 实际发出的字段，字段被悄悄丢掉会当场红。
    cfError(res, 400, 10001, "from.address, to, subject, text and html are required");
    return;
  }
  if (faultApplies(to)) {
    if (fault.mode === "reject") {
      counters.rejected += 1;
      cfError(res, 503, 2001, "email.sending.error.service_unavailable");
      return;
    }
    counters.timedOut += 1;
    await new Promise((resolve) => setTimeout(resolve, TIMEOUT_DELAY_MS));
    req.socket.destroy();
    return;
  }
  const extraHeaders = body.headers && typeof body.headers === "object" && !Array.isArray(body.headers)
    ? Object.fromEntries(Object.entries(body.headers as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
    : {};
  const receivedAt = new Date().toISOString();
  for (const recipient of to) {
    mailbox.push({ to: recipient, from, subject, text, html, receivedAt, headers: extraHeaders });
  }
  counters.accepted += 1;
  json(res, 200, {
    success: true,
    errors: [],
    messages: [],
    result: { delivered: to, permanent_bounces: [], queued: [] },
  });
}

async function handleFault(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: { mode?: unknown; to?: unknown };
  try {
    body = JSON.parse(await readBody(req)) as typeof body;
  } catch {
    json(res, 400, { error: "invalid JSON" });
    return;
  }
  if (body.mode !== "none" && body.mode !== "reject" && body.mode !== "timeout") {
    json(res, 400, { error: "mode must be none|reject|timeout" });
    return;
  }
  const to = typeof body.to === "string" && body.to.length > 0 ? body.to.toLowerCase() : null;
  fault = body.mode === "none" && to === null ? { mode: "none", to: null } : { mode: body.mode, to };
  json(res, 200, { fault });
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://loopback");
  void (async () => {
    if (req.method === "GET" && url.pathname === "/healthz") {
      json(res, 200, { ok: true });
    } else if (req.method === "POST" && url.pathname === SEND_PATH) {
      await handleSend(req, res);
    } else if (req.method === "GET" && url.pathname === "/__messages") {
      const to = url.searchParams.get("to")?.toLowerCase() ?? null;
      const sinceRaw = url.searchParams.get("since");
      const since = sinceRaw ? Date.parse(sinceRaw) : null;
      if (since !== null && Number.isNaN(since)) {
        json(res, 400, { error: "since must be an ISO timestamp" });
        return;
      }
      json(res, 200, {
        messages: mailbox.filter((m) =>
          (to === null || m.to.toLowerCase() === to) && (since === null || Date.parse(m.receivedAt) >= since)),
      });
    } else if (req.method === "DELETE" && url.pathname === "/__messages") {
      mailbox.length = 0;
      counters.accepted = 0;
      counters.rejected = 0;
      counters.timedOut = 0;
      counters.unauthorized = 0;
      json(res, 200, { ok: true });
    } else if (req.method === "GET" && url.pathname === "/__stats") {
      json(res, 200, { ...counters, fault });
    } else if (req.method === "POST" && url.pathname === "/__fault") {
      await handleFault(req, res);
    } else if (url.pathname.startsWith("/client/v4/accounts/")) {
      cfError(res, 404, 7003, "Could not route to the requested account");
    } else {
      res.writeHead(404).end();
    }
  })().catch(() => {
    if (!res.headersSent) cfError(res, 500, 1000, "loopback internal error");
    else res.destroy();
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`[loopback-mail-provider] listening on 127.0.0.1:${port}\n`);
});
