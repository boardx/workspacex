#!/usr/bin/env node
/**
 * #435 —— 全栈冒烟用的**确定性模型提供方**（OpenAI 兼容的 `/chat/completions`）。
 *
 * ## 这不是 mock fallback，区别很具体
 *
 * 本仓的红线是「**不许静默 mock fallback**」。这个进程不违反它，理由不是嘴上保证，
 * 是结构上的：
 *
 *   · 它必须被**显式选中**才会被用到。`ConfiguredModelProvider` 只认
 *     `KERNEL_MODEL_PROVIDER` 这**一个**名字，且拒绝任何与 run 快照里
 *     `model_provider` 不同的值（`configured-model-provider.ts:66-73`）——
 *     那里没有 list、没有 map、没有 "default"，因此**不存在**「悄悄退回到它」的路径。
 *   · 它不在产品代码里。`apps/api/src` 里仍然只有 `ConfiguredModelProvider` 一个
 *     `ModelCallPort` 实现；被测的是**真实适配器**走**真实 HTTP**，只是上游换成了
 *     一个我们能预测其输出的服务器。这与 `no-tool-run-writeback.test.ts:108-137`
 *     的做法是同一套，不是新发明的第二套。
 *   · 它缺席时不会有人替它兜底。不起这个进程，run 就以
 *     `MODEL_CALL_FAILED` 诚实地失败，绝不会冒出一条编造的回复。
 *
 * ## 为什么要回显用户原文
 *
 * 回复里带上用户发的那串文本，是**闭环真的穿过了整条链**的证据：
 * 浏览器 → API → PostgreSQL（human message）→ 执行器 → 本进程 → 写回 → PostgreSQL
 * → 浏览器重读。少了回显，断言就只能判「有一条 agent 消息」，
 * 而那种断言在「回复是前端合成的」时候照样绿。
 *
 * ## #728 P6 —— `stream: true` 走 SSE，不是新开关，是照抄请求里已经有的字段
 *
 * `ConfiguredModelProvider.streamImpl`（`configured-model-provider.ts`）只在
 * `KERNEL_MODEL_STREAM_ENABLED=1` 时存在，且它发出的每一次请求体里 `stream` 字段
 * 如实反映这一点——`complete()` 永远 `stream: false`，`streamImpl()` 永远
 * `stream: true`。这条协议本身已经是「显式选中」的信号，不需要在这支脚本上
 * 再叠一个独立的 `LOOPBACK_*_ENABLED` 环境变量去复述同一件事（那样反而是
 * AGENTS.md 点名的「同一事实声明在两处」）。`fullstack-smoke` 用的 API 进程从不
 * 设置 `KERNEL_MODEL_STREAM_ENABLED`，`this.completeStream` 在那条链路上根本不
 * 存在，请求体永远是 `stream: false`——本次改动前的行为一字节不变；只有
 * `playwright.chat-read.config.ts` 显式打开该开关后，这里才会真的看到
 * `stream: true` 并切到 SSE 分支。
 *
 * 回复内容按小段切片、段间插入短延迟（`STREAM_CHUNK_DELAY_MS`），不是一次性
 * 整段吐出后再包一层 SSE 外壳——那样虽然协议形状对，但 `streamingText` 在浏览器
 * 里几乎不会有非空的可观测窗口（本地/CI 都可能在一次事件循环内就把整段收完），
 * e2e 取证也就抓不到「生成中」这一帧。分片方式与
 * `loopback-deep-agent-provider.ts` 用两次状态轮询让真实轮询循环真的转一圈
 * 是同一种取证纪律：制造的是「一定会经过的中间态」，不是伪造内容本身。
 */
import { createServer } from "node:http";
import {
  FILE_CONTEXT_MESSAGE_HEADER_PREFIX,
  FILE_RETRIEVAL_SOURCE_KINDS,
} from "../src/application/agent-run/file-retrieval";
import { TOOL_TRACE_MESSAGE_HEADER_PREFIX } from "../src/application/agent-run/tool-trace-context";
import { RUN_SCRIPT_PROTOCOL_PROMPT } from "../src/application/skill/run-script-with-retries";

/**
 * F154 L2 摘要伪消息的**唯一事实源**是 `execute-run.ts` 里那一行字面量
 * （`[早前对话摘要] ${l2Summary}`），本脚本不重新声明——它不是一个像
 * `FILE_CONTEXT_MESSAGE_HEADER_PREFIX` 那样导出的常量，直接抄这个前缀本身
 * 就是唯一能不新增产品侧导出面的做法（同 `FILE_CONTEXT_MESSAGE_HEADER_PREFIX`
 * 那条注释里"读侧需要区分伪消息与 agent 字面说过这句话"的同一条纪律，这里同样
 * 只对**开头**做前缀匹配，不做全文包含）。
 */
const L2_SUMMARY_MESSAGE_HEADER_PREFIX = "[早前对话摘要]";

/**
 * 每个 SSE delta 的字符数上限，与段间延迟。4 字符/120ms 在一句十几到几十字的回显
 * 消息上，能稳定切出 5~10 帧、总时长 0.5~1s+，给足 Playwright 一个可靠等到
 * `chat-message-row-streaming` 非空、再抓一帧的窗口——切得更细、等得更久，
 * 都是为了不让这个窗口窄到需要"赌时序"才能撞见。
 */
const STREAM_CHUNK_SIZE = 4;
const STREAM_CHUNK_DELAY_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const port = Number(process.env.LOOPBACK_MODEL_PROVIDER_PORT ?? "");
if (!Number.isInteger(port) || port <= 0) {
  throw new Error("LOOPBACK_MODEL_PROVIDER_PORT must be a positive integer");
}

/**
 * 回复前缀。`core-loop.spec.ts` 用它确认回复确实出自本进程。
 *
 * ⚠ 从**环境变量**读，不在这里写字面量。唯一事实源是
 * `apps/web/e2e/fullstack-smoke-fixture.ts` 的 `agentReplyPrefix`，由
 * `playwright.fullstack-smoke.config.ts` 同时下发给本进程与断言方。
 * 两头各写一份字面量的下场很具体：改了一头没改另一头，断言会**恒红**，
 * 而且红得像是「回复没写回」——本仓已五次因「同一事实声明在两处」出事故。
 */
const REPLY_PREFIX = process.env.LOOPBACK_MODEL_REPLY_PREFIX;
if (!REPLY_PREFIX) throw new Error("LOOPBACK_MODEL_REPLY_PREFIX is required");

/**
 * #1310 —— **默认关闭**的开关：把「本进程在 history 里确实收到了一条带来源标记的 L3
 * 检索伪消息」这件事回显进回复。不设这个变量时，下面所有相关分支都不执行，回复逐字节
 * 等同于本次改动之前（`fullstack-smoke` / `core-loop` 那两条链路不下发它，行为不变）。
 *
 * ## 这不是「为了让测试变绿而伪造内容」，区别很具体
 *
 * 回显的是**它真的收到的东西**——与本脚本既有的「回显用户原文以证明闭环穿过整条链」
 * 是同一条取证纪律，只是换了一条此前无法取证的链：F155 注入的检索伪消息**不落任何表**，
 * `GET /agent-runs/:id` 的 step 只有 digest（`context_built.output_digest` 是 system prompt
 * 的哈希，不含 history）⇒ 召回与不召回，浏览器侧可观测输出**逐字节相同**。
 * 不加这条回显，真栈 e2e 里就不存在任何能证明「检索确实发生了」的信号，只能写一条恒绿的断言。
 *
 * 若检索坏掉（没注入伪消息），这里检测不到任何来源标记 ⇒ 回复里没有这段 ⇒ 断言如实红。
 * 反向对照（发一条不命中任何文件的消息）也走同一条代码，回复同样没有这段——
 * 「有没有召回」在回复里是**可区分**的，不是恒真。
 */
const RETRIEVAL_ECHO_PREFIX = process.env.LOOPBACK_MODEL_RETRIEVAL_ECHO_PREFIX ?? null;

/**
 * 从 history 里找出 L3 检索伪消息，返回它携带的来源标记（去重、按枚举顺序）。
 *
 * ⚠ **先按伪消息头前缀筛，再找来源标记**，两步缺一不可：agent 的历史回复本身就是
 *   `role: "assistant"`，而一旦某轮回复里字面出现过 `chat-attachment`（本脚本自己的回显
 *   就会造成这件事），下一轮再扫全部 assistant 消息就会把「上一轮说过这个词」误判成
 *   「这一轮召回了文件」。那样反向对照会假绿——正是这条测试要防的空转。
 *
 * 两个字面量都从产品源码 import（`file-retrieval.ts` 的
 * `FILE_CONTEXT_MESSAGE_HEADER_PREFIX` / `FILE_RETRIEVAL_SOURCE_KINDS`），不在这里抄第二份。
 */
function retrievedSourceKinds(messages: CompletionRequest["messages"]): readonly string[] {
  const seen = new Set<string>();
  for (const message of messages ?? []) {
    if (message.role !== "assistant") continue;
    const content = message.content;
    if (typeof content !== "string") continue;
    if (!content.startsWith(FILE_CONTEXT_MESSAGE_HEADER_PREFIX)) continue;
    for (const kind of FILE_RETRIEVAL_SOURCE_KINDS) {
      if (content.includes(kind)) seen.add(kind);
    }
  }
  return FILE_RETRIEVAL_SOURCE_KINDS.filter((kind) => seen.has(kind));
}

/**
 * #1559 —— **默认关闭**的第二个回显开关：把「本进程收到的 **system prompt** 里确实
 * 含有挂载 skill 的正文」这件事回显进回复。两个变量必须同时给：一个是要找的哨兵串，
 * 一个是回显前缀。任一缺失 ⇒ 下面的分支不执行，回复逐字节等同改动前
 * （`fullstack-smoke` / `core-loop` 两条链路不下发它们，行为不变）。
 *
 * ## 这不是「为了让测试变绿而伪造内容」
 *
 * 回显的是**它真的收到的东西**——与本脚本既有的「回显用户原文」「回显 L3 检索来源
 * 标记」是同一条取证纪律。没有它，「挂载的 skill 是否真的进了模型输入」在浏览器侧
 * 没有任何可观察信号：system prompt 不落表，`GET /agent-runs/:id` 的
 * `context_built.output_digest` 只是它的哈希（一个哈希证明不了里面有什么），
 * 只能写一条恒绿的断言——那正是 #1559 藏了这么久的原因。
 *
 * ## 为什么只扫 `system`，不扫全部消息
 *
 * 用户消息会被原样回显（见下面 `echoed`），而回显本身随后成为下一轮的 history。
 * 扫全部消息 ⇒ 「上一轮说过这个词」会被误判成「这一轮挂载生效了」，反向对照假绿。
 * 挂载 skill 的正文只可能出现在 system prompt 里（`buildSystemPrompt`：instructions
 * 然后 skill 正文），扫这一条就够，且不可能被别的来源污染。
 */
const SKILL_SENTINEL = process.env.LOOPBACK_MODEL_SKILL_SENTINEL || null;
const SKILL_ECHO_PREFIX = process.env.LOOPBACK_MODEL_SKILL_ECHO_PREFIX || null;

/** system prompt 里真的含有那个哨兵吗。开关未给全时恒 `false`（短路）。 */
function mountedSkillReachedModel(messages: CompletionRequest["messages"]): boolean {
  if (SKILL_SENTINEL === null || SKILL_ECHO_PREFIX === null) return false;
  const system = (messages ?? []).find((message) => message.role === "system")?.content;
  return typeof system === "string" && system.includes(SKILL_SENTINEL);
}

/**
 * context-engine 浏览器 e2e —— 默认关闭的开关，与上面 `RETRIEVAL_ECHO_PREFIX`/
 * `SKILL_ECHO_PREFIX` 同一条既有理由：L2 摘要伪消息与 F190 工具轨迹回喂伪消息都**不落
 * 任何表**，`GET /agent-runs/:id` 的 step 只有 digest，浏览器侧原本没有任何信号能证明
 * 「这一层真的把东西喂给了模型」——回显的是它真收到的东西，不是编造的。
 *
 * 两者都只扫 `role: "assistant"` 且**按前缀匹配开头**（不是 `includes` 全文），
 * 与 `retrievedSourceKinds` 同一条纪律：agent 的历史回复本身也是 `assistant`，
 * 只按开头判定才不会被"上一轮回显里字面出现过这几个字"污染。
 */
const L2_SUMMARY_ECHO_PREFIX = process.env.LOOPBACK_MODEL_L2_SUMMARY_ECHO_PREFIX ?? null;
const TOOL_TRACE_ECHO_PREFIX = process.env.LOOPBACK_MODEL_TOOL_TRACE_ECHO_PREFIX ?? null;
/**
 * 期望在工具轨迹伪消息**正文**里看到的代号（种子脚本埋进那轮历史 tool_call 的
 * `tool_result_summary` 里的那个）。与 `SKILL_SENTINEL` 同一条纪律：只回显"确实
 * 看到了这个具体代号"，不是"看到了某条随便什么样子的工具轨迹伪消息"——后者证明力
 * 弱得多，随便一条空壳伪消息也能让它恒真。
 */
const TOOL_TRACE_SENTINEL = process.env.LOOPBACK_MODEL_TOOL_TRACE_SENTINEL ?? null;

function l2SummaryReachedModel(messages: CompletionRequest["messages"]): boolean {
  if (L2_SUMMARY_ECHO_PREFIX === null) return false;
  return (messages ?? []).some((message) => (
    message.role === "assistant"
    && typeof message.content === "string"
    && message.content.startsWith(L2_SUMMARY_MESSAGE_HEADER_PREFIX)
  ));
}

function toolTraceReachedModel(messages: CompletionRequest["messages"]): boolean {
  if (TOOL_TRACE_ECHO_PREFIX === null || TOOL_TRACE_SENTINEL === null) return false;
  return (messages ?? []).some((message) => (
    message.role === "assistant"
    && typeof message.content === "string"
    && message.content.startsWith(TOOL_TRACE_MESSAGE_HEADER_PREFIX)
    && message.content.includes(TOOL_TRACE_SENTINEL)
  ));
}

/**
 * F962（design delta `skill-sandbox-execution`）—— 试跑执行链的协议要求模型回复
 * **恰好一个** ```run_script 围栏代码块（`execute-trial-run.ts` 把
 * `RUN_SCRIPT_PROTOCOL_PROMPT` 拼进 system prompt 的尾部，`extractScript` 严格按
 * 围栏解析，解析不到就落 `SCRIPT_FAILED_AFTER_RETRIES`，见该文件头注）。
 *
 * 本进程原本只会对任何请求做「回显用户原文」——这对聊天/agent-run 场景是对的，
 * 但对试跑场景，回显的原文里没有围栏，`extractScript` 必然解析失败，试跑必现失败
 * 终态。这不是本次改动引入的新分支，是 F962 落地时这条 loopback 分支就没跟上
 * 新协议——真栈 e2e 第一次真的跑通「提交→轮询→拿到结果」全链路（issue #1608 的
 * 根因排查）才第一次暴露它，此前前端从未真正轮询到过这一步。
 *
 * 判定用 system prompt 是否**逐字**包含 `RUN_SCRIPT_PROTOCOL_PROMPT`（唯一事实源
 * import 自产品代码，不在这里另抄一份字面量）——与本文件其余判定分支同一条纪律：
 * 开关未命中时这条分支不执行，其余场景的回复逐字节不变。
 *
 * 回的脚本调用 `addText` 并把用户样例输入嵌进文本参数：`loopback-skill-sandbox.ts`
 * 会从脚本里抓 `addText(...)` 字面量当幻灯片文本喂进真实 pptxgenjs，产物内容因此与
 * 请求真的相关（同文件头注「内容与请求对应」的取证纪律），不是回一个与输入无关的
 * 死脚本。
 */
function isTrialRunRequest(messages: CompletionRequest["messages"]): boolean {
  const system = (messages ?? []).find((message) => message.role === "system")?.content;
  return typeof system === "string" && system.includes(RUN_SCRIPT_PROTOCOL_PROMPT);
}

function trialRunScriptReply(sampleInput: string): string {
  const text = sampleInput.replace(/[`\\]/g, "").slice(0, 200) || "loopback trial run";
  return [
    "```run_script",
    "const pptxgenjs = require('pptxgenjs');",
    "const pres = new pptxgenjs();",
    "pres.layout = 'LAYOUT_16x9';",
    `pres.addSlide().addText('${text}', { x: 0.5, y: 0.5, fontSize: 28, bold: true });`,
    "pres.write({ outputType: 'nodebuffer' }).then((buf) => {",
    "  require('fs').writeFileSync(",
    "    require('path').join(process.env.SKILL_SANDBOX_OUT_DIR, 'deck.pptx'),",
    "    buf,",
    "  );",
    "});",
    "```",
  ].join("\n");
}

function readBody(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => { text += chunk; });
    stream.on("end", () => resolve(text));
    stream.on("error", reject);
  });
}

interface CompletionRequest {
  readonly messages?: { readonly role?: string; readonly content?: unknown }[];
  readonly stream?: unknown;
}

/**
 * `ConfiguredModelProvider.streamImpl` 解码的是逐个 `data: {...}\n\n` 帧，字段形状
 * 是 OpenAI 兼容的 `chat.completion.chunk`（`choices[0].delta.content`）——与
 * `configured-model-provider.ts` 里 `CompletionChunk` 那个接口逐字对齐,不是猜的。
 */
async function writeStreamResponse(
  res: import("node:http").ServerResponse,
  fullText: string,
): Promise<void> {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  const write = (chunk: Record<string, unknown>): void => {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  };
  for (let i = 0; i < fullText.length; i += STREAM_CHUNK_SIZE) {
    const delta = fullText.slice(i, i + STREAM_CHUNK_SIZE);
    write({ choices: [{ delta: { content: delta } }] });
    // 最后一段之后不用再等——没有下一帧要拉开窗口了。
    if (i + STREAM_CHUNK_SIZE < fullText.length) await sleep(STREAM_CHUNK_DELAY_MS);
  }
  write({ choices: [{ delta: {}, finish_reason: "stop" }] });
  res.write("data: [DONE]\n\n");
  res.end();
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
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
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid json" }));
      return;
    }
    const user = parsed.messages?.find((message) => message.role === "user")?.content;
    const echoed = typeof user === "string" ? user : "";
    // #1310 —— 开关未设置时 `kinds` 恒为空数组（短路），拼出来的字符串与改动前逐字节相同。
    const kinds = RETRIEVAL_ECHO_PREFIX === null ? [] : retrievedSourceKinds(parsed.messages);
    const retrievalEcho = kinds.length === 0 ? "" : `${RETRIEVAL_ECHO_PREFIX}${kinds.join(",")} `;
    // #1559 —— 开关未给全时恒 `""`（短路），拼出来的字符串与改动前逐字节相同。
    const skillEcho = mountedSkillReachedModel(parsed.messages)
      ? `${SKILL_ECHO_PREFIX}${SKILL_SENTINEL} `
      : "";
    // context-engine 浏览器 e2e —— 两个开关都未设置时恒为 ""（短路），拼出来的字符串
    // 与改动前逐字节相同（同 `retrievalEcho`/`skillEcho` 既有纪律）。
    const l2Echo = l2SummaryReachedModel(parsed.messages) ? `${L2_SUMMARY_ECHO_PREFIX} ` : "";
    const toolTraceEcho = toolTraceReachedModel(parsed.messages) ? `${TOOL_TRACE_ECHO_PREFIX} ` : "";
    // F962：试跑协议要求恰好一个 ```run_script 围栏，与下面「回显原文」的通用分支
    // 互斥——见 `isTrialRunRequest` 头注。命中时其余回显前缀/开关全部让路，因为
    // `extractScript` 只认围栏内容，混进去的前缀文字只会污染脚本语法。
    const fullText = isTrialRunRequest(parsed.messages)
      ? trialRunScriptReply(echoed)
      : `${REPLY_PREFIX} ${retrievalEcho}${skillEcho}${l2Echo}${toolTraceEcho}${echoed}`;
    if (parsed.stream === true) {
      await writeStreamResponse(res, fullText);
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      choices: [{ message: { role: "assistant", content: fullText } }],
    }));
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`[loopback-model-provider] listening on 127.0.0.1:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
