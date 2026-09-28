#!/usr/bin/env node
/**
 * issue #4360（S5）黄金集（`evidence/golden/`）在 loopback 上跑时的**确定性模型提供方**：只多认一种请求——
 * 「这条决定 / 待办挂到哪个目标下」（system 逐字等于产品代码里的 `KG_GOAL_LINK_SYSTEM_PROMPT`，从产品代码 import，不抄第二份）；
 * 其余一切请求（抽取、对话、追问建议）原样转给上游的 `loopback-kg-eval-model-provider.ts`（F15 评测的回环，不改它：它在评测
 * rubric 指纹里）。所以抽取与对话的行为与 F15 评测完全同一份，这里只补上挂目标这一问。
 *
 * ## 为什么不是静默 mock fallback（同上游的三条理由）
 *   - 必须被显式选中：只有 API 的 `KERNEL_MODEL_BASE_URL` 指向它才会被调用；不起它 ⇒ 挂目标调用失败，抽取任务里那一步只记日志、
 *     **不挂**（profile.ts：失败 / 读不懂都不挂），不会冒出编造的挂接。
 *   - 被测的仍是真实适配器、真实抽取 worker、真实数据库函数（kg_set_goal_link 的系统身份按证据作者推出目标空间）。
 *   - 回复完全由输入推出：请求里的「决定：…」与某个「gN. 目标原文」逐字对上 `cases.json` 的 `goalLinks` 某条 ⇒
 *     回 `{"goal":"gN","confidence":<那条的把握度>}`；对不上 ⇒ `{"goal":null,"confidence":0}`。
 *
 * 用法：LOOPBACK_GOLDEN_PROVIDER_PORT=<端口> LOOPBACK_GOLDEN_UPSTREAM=http://127.0.0.1:<上游端口> LOOPBACK_GOLDEN_CASES=evidence/golden/cases.json
 */
import { readFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { KG_GOAL_LINK_SYSTEM_PROMPT } from "../src/infrastructure/knowledge-graph/model-goal-linker";

const port = Number(process.env.LOOPBACK_GOLDEN_PROVIDER_PORT ?? "");
if (!Number.isInteger(port) || port <= 0) throw new Error("LOOPBACK_GOLDEN_PROVIDER_PORT must be a positive integer");
const upstream = new URL(process.env.LOOPBACK_GOLDEN_UPSTREAM ?? "");
const casesPath = process.env.LOOPBACK_GOLDEN_CASES;
if (!casesPath) throw new Error("LOOPBACK_GOLDEN_CASES is required (path to evidence/golden/cases.json)");

interface GoalLinkCase { readonly item: string; readonly goal: string; readonly confidence: number }
const links = (JSON.parse(readFileSync(casesPath, "utf8")) as { goalLinks?: GoalLinkCase[] }).goalLinks ?? [];
const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();

/** 请求正文（`goalLinkUserText` 的格式）：第一行「决定：…」或「待办：…」，之后「gN. 目标原文」。 */
function goalLinkReply(user: string): string {
  const lines = user.split("\n");
  const item = norm((lines[0] ?? "").replace(/^(决定|待办)：/, ""));
  const goals = lines.slice(1).flatMap((l) => {
    const m = /^(g\d+)\. (.*)$/.exec(l);
    return m === null ? [] : [{ key: m[1]!, statement: norm(m[2]!) }];
  });
  for (const c of links) {
    const g = goals.find((x) => x.statement === norm(c.goal));
    if (norm(c.item) === item && g !== undefined) return JSON.stringify({ goal: g.key, confidence: c.confidence });
  }
  return JSON.stringify({ goal: null, confidence: 0 });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function forward(req: IncomingMessage, raw: string, res: ServerResponse): void {
  const up = httpRequest({
    host: upstream.hostname, port: upstream.port, method: req.method, path: req.url,
    headers: { ...req.headers, host: upstream.host, "content-length": Buffer.byteLength(raw) },
  }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on("error", () => { if (!res.headersSent) res.writeHead(502).end(); });
  up.end(raw);
}

interface Message { readonly role?: string; readonly content?: unknown }
const text = (m: Message | undefined): string => (typeof m?.content === "string" ? m.content : "");

const server = createServer((req, res) => {
  void readBody(req).then((raw) => {
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) { forward(req, raw, res); return; }
    let parsed: { messages?: Message[]; stream?: unknown };
    try { parsed = JSON.parse(raw) as typeof parsed; } catch { forward(req, raw, res); return; }
    const messages = parsed.messages ?? [];
    if (text(messages.find((m) => m.role === "system")) !== KG_GOAL_LINK_SYSTEM_PROMPT) { forward(req, raw, res); return; }
    const reply = goalLinkReply(text([...messages].reverse().find((m) => m.role === "user")));
    if (parsed.stream === true) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.end("data: [DONE]\n\n");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: reply }, finish_reason: "stop" }] }));
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`[loopback-golden-model-provider] listening on 127.0.0.1:${port} (upstream ${upstream.origin}, ${links.length} goal links)\n`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => server.close(() => process.exit(0)));
