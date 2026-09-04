/**
 * #2504 —— pptx 任务提交后等待 300+ 秒超时。
 *
 * 根因见 `configured-model-provider.ts` 的 `postCompletions` 头注：这个部署配的是
 * 通义千问，Qwen3 系模型缺省开启深度思考，`complete()` 恒为 `stream: false`，调用方
 * 要等整段隐藏 reasoning + 正文都生成完才拿到响应——大 system prompt（pptx skill）
 * 下这段等待被进一步拉长，叠加 #1611 已经放宽到的 180s 超时依然不够。
 *
 * 修法是显式在非流式请求体里带 `enable_thinking: false`，而不是继续加长超时预算。
 * 这里直接检查上游收到的请求体，而不是只看返回值——一个"忘了带这个字段但仍能拼出
 * 正确回复"的实现会让别的测试全绿，只有读请求体才拦得住。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ConfiguredModelProvider } from "../../src/infrastructure/agent-run/configured-model-provider";

const PROVIDER = "i2504-loopback";
const API_KEY = "sk-i2504-secret-do-not-echo";
const MODEL_ID = "qwen3.7-plus";

let server: Server;
let base = "";
let lastBody: Record<string, unknown> | null = null;

async function startServer(): Promise<void> {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      lastBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (lastBody?.stream === true) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "hi" } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
}

function provider(streamEnabled: boolean): ConfiguredModelProvider {
  return new ConfiguredModelProvider({
    provider: PROVIDER, baseUrl: base, apiKey: API_KEY, timeoutMs: 5_000, streamEnabled, visionModelIds: new Set<string>(),
  });
}

beforeAll(async () => { await startServer(); });
afterEach(() => { lastBody = null; });
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

describe("#2504 ConfiguredModelProvider 对 Qwen3 关闭非流式 thinking", () => {
  it("complete()（stream: false）的请求体带 enable_thinking: false", async () => {
    await provider(false).complete({ modelProvider: PROVIDER, modelId: MODEL_ID, system: "s", user: "u" });

    expect(lastBody).not.toBeNull();
    expect(lastBody?.stream).toBe(false);
    // ⭐ 反证锚点：把 postCompletions 里的 `...(stream ? {} : { enable_thinking: false })`
    // 删掉，这条立刻红。
    expect(lastBody?.enable_thinking).toBe(false);
  });

  it("completeStream()（stream: true）不带 enable_thinking——流式路径不在本次修复范围内", async () => {
    const p = provider(true);
    await p.completeStream?.({ modelProvider: PROVIDER, modelId: MODEL_ID, system: "s", user: "u" }, async () => {});

    expect(lastBody).not.toBeNull();
    expect(lastBody?.stream).toBe(true);
    expect(lastBody).not.toHaveProperty("enable_thinking");
  });
});
