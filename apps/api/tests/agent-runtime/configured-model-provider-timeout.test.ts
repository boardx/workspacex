/**
 * #1611 —— `KERNEL_MODEL_TIMEOUT_MS` 真的说了算 + 传输失败原因不再被销毁。
 *
 * ## 这里为什么必须是真 socket
 *
 * 被修的东西是 **undici 的 `headersTimeout` 有没有被覆盖**。mock 掉 `fetch` 的测试对这
 * 件事**结构性地无话可说**：`headersTimeout` 是连接层的行为，只有真的有一条 TCP 连接、
 * 真的有一端不写响应头，它才会被触发。所以 T1 起一个「accept 连接后永远不回响应头」的
 * 本地服务器。
 *
 * ## 每条都配了会红的反证（本仓九次踩过"全绿但空转"）
 *
 * - T1-CP：把 `dispatcher` 摘掉 ⇒ headersTimeout 回落到 undici 默认 300s，先触发的变成
 *   `AbortSignal`，失败分类从 `UND_ERR_HEADERS_TIMEOUT` 变成 `ABORTED` ⇒ T1 红。
 *   （测试断言的是**分类**而不是"耗时 < 300s"，所以 CP 只要几秒就能看出来，不会让 CI
 *   干等 5 分钟。这也是实现里 `ABORT_GRACE_MS` 存在的理由：让先触发的那个是能说清原因
 *   的那个。）
 * - T2-CP：把 `classifyTransportError` 改成恒定返回一个 token ⇒ T2 红。
 * - T3：成功路径仍然成功。少了这格，一个"永远抛错"的实现能把 T1/T2/T4 全绿骗过去。
 * - T4：抛出的错误里不含 baseUrl / apiKey / 主机名——这是原设计裸 `catch {}` 的核心
 *   顾虑，现在由机械断言钉住，而不是由注释保证。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConfiguredModelProvider,
  classifyTransportError,
  type ConfiguredModelProviderConfig,
} from "../../src/infrastructure/agent-run/configured-model-provider";
import { ModelCallError } from "../../src/application/agent-run/ports";

const PROVIDER = "i1611-loopback";
const API_KEY = "sk-i1611-secret-do-not-echo";
const MODEL_ID = "i1611-model";

const openProviders: ConfiguredModelProvider[] = [];
const openServers: Server[] = [];

function makeProvider(overrides: Partial<ConfiguredModelProviderConfig>): ConfiguredModelProvider {
  const provider = new ConfiguredModelProvider({
    provider: PROVIDER,
    baseUrl: "http://127.0.0.1:1",
    apiKey: API_KEY,
    timeoutMs: 1_500,
    streamEnabled: false,
    visionModelIds: new Set<string>(),
    ...overrides,
  } as ConfiguredModelProviderConfig);
  openProviders.push(provider);
  return provider;
}

async function startServer(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  openServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}`;
}

/** 一个确定连不上的本地端口：listen(0) 拿到一个空闲端口，随即关掉。 */
async function closedPort(): Promise<string> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await Promise.all(openProviders.splice(0).map((p) => p.close()));
  await Promise.all(
    openServers.splice(0).map((s) => new Promise<void>((resolve) => {
      s.closeAllConnections?.();
      s.close(() => resolve());
    })),
  );
});

function call(provider: ConfiguredModelProvider): Promise<unknown> {
  return provider.complete({
    modelProvider: PROVIDER,
    modelId: MODEL_ID,
    system: "s",
    user: "u",
  });
}

describe("#1611 configured model provider timeouts + transport error classification", () => {
  it("T1: headersTimeout 取自 config.timeoutMs（上游永不回响应头 ⇒ 按配置的 1.5s 失败，不是 undici 默认 300s）", async () => {
    // accept 连接，然后什么都不写——响应头永远不来。这正是 headersTimeout 管的场景。
    const base = await startServer(() => { /* 故意不 writeHead、不 end */ });
    const provider = makeProvider({ baseUrl: base, timeoutMs: 1_500 });

    const startedAt = Date.now();
    const err = await call(provider).then(() => null, (e: unknown) => e);
    const elapsed = Date.now() - startedAt;

    expect(err).toBeInstanceOf(ModelCallError);
    // ⭐ 反证锚点：没有 dispatcher 时 headersTimeout 是 300s，先触发的会是 AbortSignal，
    // 这里就会读到 "ABORTED"。分类不同 ⇒ 测试红，且几秒内就红。
    expect((err as ModelCallError).detail).toContain("UND_ERR_HEADERS_TIMEOUT");
    // 配置的 1.5s 真的是上限：远小于 undici 默认的 300s，也小于 abort 宽限后的 3.5s。
    expect(elapsed).toBeLessThan(3_000);
    expect(elapsed).toBeGreaterThanOrEqual(1_000);
  }, 20_000);

  it("T2: cause.code 被白名单映射成不同分类，而不是塌缩成同一个 token", () => {
    const withCause = (code: unknown): unknown => Object.assign(new Error("fetch failed"), { cause: { code } });

    expect(classifyTransportError(withCause("UND_ERR_HEADERS_TIMEOUT"))).toBe("UND_ERR_HEADERS_TIMEOUT");
    expect(classifyTransportError(withCause("ECONNREFUSED"))).toBe("ECONNREFUSED");
    expect(classifyTransportError(withCause("ENOTFOUND"))).toBe("ENOTFOUND");
    expect(classifyTransportError(Object.assign(new Error("x"), { name: "AbortError" }))).toBe("ABORTED");
    // 白名单外的取值不回显（未知 code 理论上可以是上游造的任意字符串）。
    expect(classifyTransportError(withCause("SOMETHING-http://user:pw@host:9/x"))).toBe("UNCLASSIFIED");
    expect(classifyTransportError(undefined)).toBe("UNCLASSIFIED");

    // ⭐ 反证锚点：把映射改成恒定一个码，下面这条立刻红。
    const distinct = new Set([
      classifyTransportError(withCause("UND_ERR_HEADERS_TIMEOUT")),
      classifyTransportError(withCause("ECONNREFUSED")),
      classifyTransportError(withCause("nope")),
    ]);
    expect(distinct.size).toBe(3);
  });

  it("T3（反空转）: 正常成功路径仍然正常——走的是同一个 dispatcher", async () => {
    const base = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { content: "hello from i1611" } }],
        usage: { total_tokens: 12, prompt_tokens: 5, completion_tokens: 7 },
      }));
    });
    const provider = makeProvider({ baseUrl: base, timeoutMs: 5_000 });

    const out = await provider.complete({
      modelProvider: PROVIDER, modelId: MODEL_ID, system: "s", user: "u",
    });

    expect(out.text).toBe("hello from i1611");
    expect(out.tokens).toBe(12);
    expect(out.promptTokens).toBe(5);
    expect(out.completionTokens).toBe(7);
  }, 20_000);

  it("T4（不泄露）: 抛出的错误里没有 baseUrl、apiKey、主机名或端口", async () => {
    // 连不上的端口 ⇒ 真实 ECONNREFUSED，其原始 message 里带 127.0.0.1 和端口号。
    // ⚠ 端口先 listen 再 close 拿到，而不是写死一个数：写死的低端口（如 9）会被 fetch
    // 规范当成 "bad port" 直接拒绝，那条路径根本走不到 socket，测不到本条要测的东西。
    const base = await closedPort();
    const provider = makeProvider({ baseUrl: base, timeoutMs: 2_000 });

    const err = await call(provider).then(() => null, (e: unknown) => e) as ModelCallError;

    expect(err).toBeInstanceOf(ModelCallError);
    expect(err.detail).toContain("ECONNREFUSED");
    const surface = `${err.message} ${err.detail} ${err.code}`;
    for (const secret of [API_KEY, base, "127.0.0.1", "Bearer"]) {
      expect(surface).not.toContain(secret);
    }
  }, 20_000);
});
