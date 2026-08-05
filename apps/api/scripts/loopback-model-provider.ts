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
 */
import { createServer } from "node:http";

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
  void readBody(req).then((raw) => {
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
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      choices: [{ message: { role: "assistant", content: `${REPLY_PREFIX} ${echoed}` } }],
    }));
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`[loopback-model-provider] listening on 127.0.0.1:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
