/**
 * #654 阶段2a — `ConfiguredModelProvider.completeStream`.
 *
 * Same philosophy as `no-tool-run-writeback.test.ts`'s own header: the adapter is the
 * thing that can actually be wrong (the SSE frame it sends, how partial TCP chunks get
 * reassembled, what happens when a frame is malformed or the socket resets), so this runs
 * a real loopback HTTP server that writes real `text/event-stream` bytes -- including
 * split across multiple `res.write()` calls, which is where a naive line-by-line parser
 * breaks -- rather than mocking `fetch`.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ConfiguredModelProvider } from "../../src/infrastructure/agent-run/configured-model-provider";
import { ModelCallError } from "../../src/application/agent-run/ports";

const PROVIDER = "wave2-loopback-stream";
const API_KEY = "sk-i654-stream-do-not-echo";

let server: Server;
let base = "";
let nextFrames: string[] = [];
let nextStatus = 200;
let frameDelayMs = 0;

async function startServer(): Promise<void> {
  server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    if (nextStatus !== 200) {
      res.writeHead(nextStatus, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "boom" }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    (async () => {
      for (const frame of nextFrames) {
        if (frameDelayMs > 0) await new Promise((r) => setTimeout(r, frameDelayMs));
        res.write(frame);
      }
      res.end();
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
}

function sseChunk(deltaContent: string | null, opts: { finish?: boolean; usage?: number } = {}): string {
  const choice: Record<string, unknown> = { delta: deltaContent === null ? {} : { content: deltaContent } };
  if (opts.finish) choice.finish_reason = "stop";
  const payload: Record<string, unknown> = { choices: [choice] };
  if (opts.usage !== undefined) payload.usage = { total_tokens: opts.usage };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function provider(): ConfiguredModelProvider {
  return new ConfiguredModelProvider({
    provider: PROVIDER, baseUrl: base, apiKey: API_KEY, timeoutMs: 5_000, streamEnabled: true, visionModelIds: new Set<string>(),
  });
}

beforeAll(async () => { await startServer(); });
afterEach(() => { nextFrames = []; nextStatus = 200; frameDelayMs = 0; });
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

describe("ConfiguredModelProvider.completeStream", () => {
  it("每个 delta 按到达顺序回调，最终文本是拼接结果，usage 取最后一次上报", async () => {
    nextFrames = [
      sseChunk("Hel"),
      sseChunk("lo, "),
      sseChunk("world"),
      sseChunk(null, { finish: true, usage: 7 }),
      "data: [DONE]\n\n",
    ];
    const seen: string[] = [];
    const result = await provider().completeStream!(
      { modelProvider: PROVIDER, modelId: "m1", system: "s", user: "u" },
      async (d) => { seen.push(d); },
    );
    expect(seen).toEqual(["Hel", "lo, ", "world"]);
    expect(result.text).toBe("Hello, world");
    expect(result.tokens).toBe(7);
  });

  it("一帧被拆成多次 TCP 写入也能正确重组（不是每次 write 都恰好是一整帧）", async () => {
    const whole = sseChunk("reassembled");
    // Split the single SSE frame at an arbitrary byte offset -- exactly the case a naive
    // "treat every `write` as one frame" parser gets wrong.
    const cut = Math.floor(whole.length / 2);
    nextFrames = [whole.slice(0, cut), whole.slice(cut), "data: [DONE]\n\n"];
    const seen: string[] = [];
    const result = await provider().completeStream!(
      { modelProvider: PROVIDER, modelId: "m1", system: "s", user: "u" },
      async (d) => { seen.push(d); },
    );
    expect(seen).toEqual(["reassembled"]);
    expect(result.text).toBe("reassembled");
  });

  it("一帧解析失败(非 JSON)被跳过，不中断其余帧——不是「一帧坏就整条回复失败」", async () => {
    nextFrames = [sseChunk("a"), "data: {not json\n\n", sseChunk("b"), "data: [DONE]\n\n"];
    const seen: string[] = [];
    const result = await provider().completeStream!(
      { modelProvider: PROVIDER, modelId: "m1", system: "s", user: "u" },
      async (d) => { seen.push(d); },
    );
    expect(seen).toEqual(["a", "b"]);
    expect(result.text).toBe("ab");
  });

  it("HTTP 非 2xx：ModelCallError(MODEL_CALL_FAILED)，响应体从不被读出用于错误信息", async () => {
    nextStatus = 500;
    await expect(
      provider().completeStream!(
        { modelProvider: PROVIDER, modelId: "m1", system: "s", user: "u" },
        async () => {},
      ),
    ).rejects.toMatchObject({ code: "MODEL_CALL_FAILED" });
  });

  it("run 钉的 provider 与部署配置的 provider 不一致：拒绝，不悄悄改用配置的那个", async () => {
    await expect(
      provider().completeStream!(
        { modelProvider: "some-other-provider", modelId: "m1", system: "s", user: "u" },
        async () => {},
      ),
    ).rejects.toMatchObject({ code: "MODEL_PROVIDER_NOT_CONFIGURED" });
  });

  it("onDelta 抛错时整个调用失败，增量不是「尽力而为」", async () => {
    nextFrames = [sseChunk("a"), sseChunk("b"), "data: [DONE]\n\n"];
    await expect(
      provider().completeStream!(
        { modelProvider: PROVIDER, modelId: "m1", system: "s", user: "u" },
        async () => { throw new Error("store append failed"); },
      ),
    ).rejects.toMatchObject({ code: "MODEL_CALL_FAILED", detail: "model provider stream transport failure" });
  });

  it("未配置 provider：ModelCallError(MODEL_PROVIDER_NOT_CONFIGURED)，与 complete() 同一个失败面", async () => {
    const unconfigured = new ConfiguredModelProvider({
      provider: "", baseUrl: "", apiKey: "", timeoutMs: 1000, streamEnabled: true, visionModelIds: new Set<string>(),
    });
    await expect(
      unconfigured.completeStream!(
        { modelProvider: PROVIDER, modelId: "m1", system: "s", user: "u" },
        async () => {},
      ),
    ).rejects.toBeInstanceOf(ModelCallError);
  });

  it("streamEnabled=false（默认值）：completeStream 根本不存在，execute-run.ts 的存在性判断会退回 complete() —— " +
    "这是本文件其余用例全都显式传 streamEnabled:true 的原因：默认关闭是刻意的，不是遗漏", () => {
    const off = new ConfiguredModelProvider({
      provider: PROVIDER, baseUrl: base, apiKey: API_KEY, timeoutMs: 5_000, streamEnabled: false, visionModelIds: new Set<string>(),
    });
    expect(off.completeStream).toBeUndefined();
  });
});
