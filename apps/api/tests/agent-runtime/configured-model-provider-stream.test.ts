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
/**
 * issue #2104 —— 帧分隔符的行尾。`"lf"` 是本套件历史上唯一说过的方言（`\n\n`）；
 * `"crlf"`（`\r\n\r\n`）才是 SSE 规范同样允许、且 sse-starlette 一类实现默认发出的
 * 那一种。这个开关存在的唯一理由：解析器必须对**两种**都成立。#2098 里同形的 bug 能在
 * 一套显式断言 token 级流式的反证套件下活下来，正是因为所有替身都只说 LF。
 */
type LineEnding = "lf" | "crlf";
let nextLineEnding: LineEnding = "lf";
const eol = (): string => (nextLineEnding === "crlf" ? "\r\n" : "\n");

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
  return `data: ${JSON.stringify(payload)}${eol()}${eol()}`;
}

function doneFrame(): string {
  return `data: [DONE]${eol()}${eol()}`;
}

function provider(): ConfiguredModelProvider {
  return new ConfiguredModelProvider({
    provider: PROVIDER, baseUrl: base, apiKey: API_KEY, timeoutMs: 5_000, streamEnabled: true, visionModelIds: new Set<string>(), thinkingDisableModelIds: new Set<string>(),
  });
}

beforeAll(async () => { await startServer(); });
afterEach(() => { nextFrames = []; nextStatus = 200; frameDelayMs = 0; nextLineEnding = "lf"; });
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

describe("ConfiguredModelProvider.completeStream", () => {
  it("每个 delta 按到达顺序回调，最终文本是拼接结果，usage 取最后一次上报", async () => {
    nextFrames = [
      sseChunk("Hel"),
      sseChunk("lo, "),
      sseChunk("world"),
      sseChunk(null, { finish: true, usage: 7 }),
      doneFrame(),
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
    nextFrames = [whole.slice(0, cut), whole.slice(cut), doneFrame()];
    const seen: string[] = [];
    const result = await provider().completeStream!(
      { modelProvider: PROVIDER, modelId: "m1", system: "s", user: "u" },
      async (d) => { seen.push(d); },
    );
    expect(seen).toEqual(["reassembled"]);
    expect(result.text).toBe("reassembled");
  });

  /**
   * issue #2104 —— 与 #2098 同形的反证。SSE 规范（WHATWG）允许行以 CRLF / CR / LF
   * 结束；上游说 CRLF 时帧分隔符是 `\r\n\r\n`，里面**不含** `\n\n` 子串。解析器此前
   * 按 `indexOf("\n\n")` 切帧，对这些字节一帧都切不出来：整条流被读完、零个事件被解析、
   * 不抛错也不告警，流式静默降级成一次性整段回复（前端表现＝空白十几秒后整段一次性出现）。
   *
   * 上面那条 LF 用例**一直是绿的**，因为本套件与 `loopback-model-provider.ts` 说的都是
   * LF——替身的方言不是规范的全集。这条用例把同一份断言换成 CRLF 再跑一遍；去掉解析器里
   * 的行尾归一化，它必红，而 LF 那几条纹丝不动。
   */
  it("上游说 CRLF 时同样逐帧出 delta——帧分隔符是 \\r\\n\\r\\n，不含 \\n\\n", async () => {
    nextLineEnding = "crlf";
    nextFrames = [
      sseChunk("Hel"),
      sseChunk("lo, "),
      sseChunk("world"),
      sseChunk(null, { finish: true, usage: 7 }),
      doneFrame(),
    ];
    const seen: string[] = [];
    const result = await provider().completeStream!(
      { modelProvider: PROVIDER, modelId: "m1", system: "s", user: "u" },
      async (d) => { seen.push(d); },
    );
    // 逐字节等价于 LF 那条用例：内容、顺序、终稿、usage，一条都不放松。
    expect(seen).toEqual(["Hel", "lo, ", "world"]);
    expect(result.text).toBe("Hello, world");
    expect(result.tokens).toBe(7);
  });

  /**
   * issue #2104 —— 归一化必须对**整个剩余 buffer** 做，不能只对本次 decode 的分片做。
   * 一个 `\r\n` 会被 TCP 分片从中间劈开（`\r` 落在上一片尾、`\n` 落在下一片头）；只归一化
   * 分片时那个 `\r` 永远等不到它的 `\n`，帧边界就切不出来。
   *
   * ⚠ 这里断言的是**到达时刻分散**，不只是内容——因为「只归一化新分片」那个写法**内容
   *   照样对**：所有帧一直粘在 buffer 里，直到末尾 `[DONE]` 那片自带 `\n\n` 才被一次性
   *   切开，三个 delta 于是在同一毫秒里挤出来。那正是本 issue 要防的用户可见症状（空白
   *   十几秒后整段一次性出现），内容断言看不见它。实测：把修法换成只归一化分片，本用例
   *   的 `arrivals[2].at - arrivals[0].at` 从 ~100ms 掉到 ~0ms。
   */
  it("CRLF 的 \\r 与 \\n 被 TCP 分片劈开时仍逐帧出 delta——全 buffer 归一化是幂等的，只归一化新分片会把整条流攒到最后一次性吐出", async () => {
    nextLineEnding = "crlf";
    // 两次 write 之间拉开时间窗，否则 Node 可能把它们合进同一个 TCP 包，
    // 「跨分片」这件事就没真的发生过。
    frameDelayMs = 25;
    const contents = ["He", "llo ", "world"];
    // 每帧末尾四个字符是 \r \n \r \n；切在**最后一个 \n 之前** => 上一片以孤立的 \r 结尾。
    nextFrames = contents.flatMap((c) => {
      const whole = sseChunk(c);
      expect(whole.slice(-2)).toBe("\r\n");
      return [whole.slice(0, -1), whole.slice(-1)];
    });
    nextFrames.push(doneFrame());
    const arrivals: { delta: string; at: number }[] = [];
    const result = await provider().completeStream!(
      { modelProvider: PROVIDER, modelId: "m1", system: "s", user: "u" },
      async (d) => { arrivals.push({ delta: d, at: performance.now() }); },
    );
    expect(arrivals.map((a) => a.delta)).toEqual(contents);
    // 下界，不是等式：负载高只会让间隔更大，不会让它变小。
    expect(arrivals[2]!.at - arrivals[0]!.at).toBeGreaterThanOrEqual(30);
    expect(result.text).toBe("Hello world");
  });

  it("一帧解析失败(非 JSON)被跳过，不中断其余帧——不是「一帧坏就整条回复失败」", async () => {
    nextFrames = [sseChunk("a"), `data: {not json${eol()}${eol()}`, sseChunk("b"), doneFrame()];
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
    nextFrames = [sseChunk("a"), sseChunk("b"), doneFrame()];
    await expect(
      provider().completeStream!(
        { modelProvider: PROVIDER, modelId: "m1", system: "s", user: "u" },
        async () => { throw new Error("store append failed"); },
      ),
      // #1611：`detail` 末尾多了一个白名单枚举 token（这里是 `UNCLASSIFIED`——onDelta
      // 抛的是调用方自己的错误，没有 undici/Node 的 `cause.code`）。断言收紧成前缀匹配，
      // 而不是放宽成"随便什么字符串"：provider 的原话仍然一个字都不许进来。
    ).rejects.toMatchObject({
      code: "MODEL_CALL_FAILED",
      detail: expect.stringMatching(/^model provider stream transport failure \([A-Z_]+\)$/),
    });
  });

  it("未配置 provider：ModelCallError(MODEL_PROVIDER_NOT_CONFIGURED)，与 complete() 同一个失败面", async () => {
    const unconfigured = new ConfiguredModelProvider({
      provider: "", baseUrl: "", apiKey: "", timeoutMs: 1000, streamEnabled: true, visionModelIds: new Set<string>(), thinkingDisableModelIds: new Set<string>(),
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
      provider: PROVIDER, baseUrl: base, apiKey: API_KEY, timeoutMs: 5_000, streamEnabled: false, visionModelIds: new Set<string>(), thinkingDisableModelIds: new Set<string>(),
    });
    expect(off.completeStream).toBeUndefined();
  });
});
