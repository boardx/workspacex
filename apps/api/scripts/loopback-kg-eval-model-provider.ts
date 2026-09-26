#!/usr/bin/env node
/**
 * phase-18 F15 记忆体验评测集（`apps/web/e2e/kg-experience-eval/`）专用的**确定性模型提供方**（OpenAI 兼容
 * `/chat/completions`）。只在 `playwright.kg-experience-eval.config.ts` 里起，产品代码不认识它。
 *
 * ## 为什么不是静默 mock fallback（同 `loopback-model-provider.ts` 的三条理由）
 *   - 必须被显式选中：API 的 `KERNEL_MODEL_PROVIDER` 与 run 快照里的 provider 全等才会调用它；
 *     不起这个进程，run 以 `MODEL_CALL_FAILED` 诚实失败，抽取也只会失败重试，不会冒出编造的记忆。
 *   - 被测的仍是真实适配器（`ConfiguredModelProvider`）走真实 HTTP、真实执行器、真实抽取 worker、真实 AGE 投影。
 *   - 它的每一个输出都能从输入推出来（见下两节），不读任何外部状态。
 *
 * ## 抽取请求：只对语料里逐字出现的「用户说的」那句话回 JSON
 * 认法：system 逐字等于 `KG_EXTRACTION_SYSTEM_PROMPT`（从产品代码 import，不抄第二份）。
 * user 形如「本条消息（用户说的）：\n<原话>」——原话逐字命中语料 `cases.json` 的某条 `say`，回它的 `extract`；
 * 其余（助手的回答、提问、闲聊、没登记的话）一律回空 `{"entities":[],"claims":[]}`。它扮演「把这句话读对了的
 * 抽取模型」：抽取质量不是本评测量的东西（本机没有真实模型），被量的是抽出来之后产品怎么用它。
 *
 * ## 对话请求：只照着这一轮收到的【记忆】作答（grounded，同 F14 `kg-e2e-fixtures.ts` 的 groundedModel）
 * 回答里有没有某个事实，完全取决于执行器这一轮真的交给模型什么（召回名次、作用域、删除失效都体现在这里），
 * 而不是评测里写死的字符串：
 *   - 有【记忆】⇒「根据之前的对话：<每条记忆的原文（及它的出处说明）>。」按召回名次，全部照抄。
 *   - 有【记忆卡片】说明 ⇒ 照说明的意思说一句（卡片出了还没生效 / 没找到相关的记忆）。
 *   - 什么都没有：问句 ⇒「我没有找到相关的记忆。」；陈述 ⇒「好的，收到。」
 * 流式（`stream: true`）按小段吐字，E10 量「发消息到首字」用。
 *
 * 追问建议请求（`FOLLOWUP_SUGGESTIONS_SYSTEM_PROMPT`）回空列表：评测不量它，也不让它在界面上多出东西。
 */
import { createServer, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { FOLLOWUP_SUGGESTIONS_SYSTEM_PROMPT } from "../src/application/chat/generate-followup-suggestions";
import { KG_EXTRACTION_SYSTEM_PROMPT } from "../src/infrastructure/knowledge-graph/model-knowledge-extractor";

const port = Number(process.env.LOOPBACK_KG_EVAL_PROVIDER_PORT ?? "");
if (!Number.isInteger(port) || port <= 0) throw new Error("LOOPBACK_KG_EVAL_PROVIDER_PORT must be a positive integer");
const casesPath = process.env.LOOPBACK_KG_EVAL_CASES;
if (!casesPath) throw new Error("LOOPBACK_KG_EVAL_CASES is required (path to apps/web/e2e/kg-experience-eval/cases.json)");

interface Cases { readonly says: Record<string, { readonly say: string; readonly extract: unknown }> }
const cases = JSON.parse(readFileSync(casesPath, "utf8")) as Cases;
const extractions = new Map(Object.values(cases.says).map((s) => [normalize(s.say), JSON.stringify(s.extract)]));

const EMPTY_EXTRACTION = '{"entities":[],"claims":[]}';
const EXTRACTION_USER_PREFIX = "本条消息（用户说的）：\n";
const MEMORY_HEADER = "【记忆】";
const CARD_HEADER = "【记忆卡片】";
/** 流式分片：每段几个字、段间一点间隔——够让浏览器看到「首字」先于整段到达，又不拖慢评测。 */
const STREAM_CHUNK = 6;
const STREAM_DELAY_MS = 15;

function normalize(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

interface Message { readonly role?: string; readonly content?: unknown }
interface CompletionRequest { readonly messages?: readonly Message[]; readonly stream?: unknown }

const text = (m: Message | undefined): string => (typeof m?.content === "string" ? m.content : "");

function extractionReply(messages: readonly Message[]): string {
  const user = text([...messages].reverse().find((m) => m.role === "user"));
  if (!user.startsWith(EXTRACTION_USER_PREFIX)) return EMPTY_EXTRACTION;
  return extractions.get(normalize(user.slice(EXTRACTION_USER_PREFIX.length))) ?? EMPTY_EXTRACTION;
}

/** 【记忆】里的每一条：「- [你确认过] 原文（出处）」→「原文（出处）」。降级说明那一行不是记忆，不照抄。 */
function memoryFacts(memory: string): string[] {
  return memory.split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).replace(/^\[[^\]]*\]\s*/, "").trim())
    .filter((l) => l.length > 0);
}

function chatReply(messages: readonly Message[]): string {
  const assistantNotes = messages.filter((m) => m.role === "assistant").map(text);
  const memory = assistantNotes.find((c) => c.startsWith(MEMORY_HEADER)) ?? null;
  const card = assistantNotes.find((c) => c.startsWith(CARD_HEADER)) ?? null;
  const user = text([...messages].reverse().find((m) => m.role === "user")).trim();
  const parts: string[] = [];
  if (card !== null) {
    if (card.includes("没找到相关的记忆")) parts.push("没找到相关的记忆。");
    else if (card.includes("点「记住」")) parts.push("好的，我在下面放了一张确认卡，点「记住」之后才会记下。");
    else if (card.includes("点「忘掉」")) parts.push("相关的记忆列在下面了，点「忘掉」之后才会生效。");
  }
  const facts = memory === null ? [] : memoryFacts(memory);
  if (facts.length > 0) parts.push(`根据之前的对话：${facts.join("；")}。`);
  if (parts.length === 0) parts.push(/[?？]$/.test(user) ? "我没有找到相关的记忆。" : "好的，收到。");
  return parts.join("\n\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeStream(res: ServerResponse, full: string): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" });
  const chars = Array.from(full);
  for (let i = 0; i < chars.length; i += STREAM_CHUNK) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chars.slice(i, i + STREAM_CHUNK).join("") } }] })}\n\n`);
    if (i + STREAM_CHUNK < chars.length) await sleep(STREAM_DELAY_MS);
  }
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
    return;
  }
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }
  void readBody(req).then(async (raw) => {
    let parsed: CompletionRequest;
    try {
      parsed = JSON.parse(raw) as CompletionRequest;
    } catch {
      res.writeHead(400, { "content-type": "application/json" }).end('{"error":"invalid json"}');
      return;
    }
    const messages = parsed.messages ?? [];
    const system = text(messages.find((m) => m.role === "system"));
    const reply = system === KG_EXTRACTION_SYSTEM_PROMPT
      ? extractionReply(messages)
      : system.includes(FOLLOWUP_SUGGESTIONS_SYSTEM_PROMPT)
        ? "[]"
        : chatReply(messages);
    if (parsed.stream === true) {
      await writeStream(res, reply);
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: reply }, finish_reason: "stop" }] }));
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`[loopback-kg-eval-model-provider] listening on 127.0.0.1:${port} (${extractions.size} extraction replies)\n`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => server.close(() => process.exit(0)));
