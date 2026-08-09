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
    const fullText = `${REPLY_PREFIX} ${echoed}`;
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
