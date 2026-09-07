/**
 * 迭代 12（design-delta `paged-generation-and-doc-export` §1.3）—— V43。
 *
 * 在这次改动之前，本仓**一处也没有**设置过输出上限：用的是 provider 默认值，
 * 于是"天花板在哪"既没设定也没观测，撞上了才知道（表现是输出被截断、JSON 解析失败、
 * 而上层只能反推）。这里加的是一个运维开关 `KERNEL_MODEL_MAX_OUTPUT_TOKENS`。
 *
 * 两条都必要：
 *   ① 设了 ⇒ 请求体带 `max_tokens`；
 *   ② **不设 ⇒ 请求体一个字都不多**——如果这里填一个我们自己编的默认值，
 *      所有既有部署的行为都会在无人察觉的情况下改变。②只测"能设"是测不出来的。
 *
 * 同时钉住 `finish_reason: "length"` 一路带回端口的 `truncated`——它是
 * `MODEL_OUTPUT_TRUNCATED` 这个闭集成员的唯一真实来源。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ConfiguredModelProvider, readModelProviderConfig } from "../../src/infrastructure/agent-run/configured-model-provider";

const PROVIDER = "iter12-loopback";
let server: Server;
let base = "";
let lastBody: Record<string, unknown> | null = null;
let finishReason = "stop";

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      lastBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "hi" }, finish_reason: finishReason }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => { lastBody = null; finishReason = "stop"; });
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

const provider = (maxOutputTokens?: number) =>
  new ConfiguredModelProvider({
    provider: PROVIDER, baseUrl: base, apiKey: "sk-iter12", timeoutMs: 5_000, streamEnabled: false,
    visionModelIds: new Set<string>(), thinkingDisableModelIds: new Set<string>(), bailianExtensionsEnabled: false,
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
  });

describe("V43 KERNEL_MODEL_MAX_OUTPUT_TOKENS", () => {
  it("① 设了 ⇒ 请求体带 max_tokens", async () => {
    await provider(2048).complete({ modelProvider: PROVIDER, modelId: "m", system: "s", user: "u" });
    expect(lastBody?.max_tokens).toBe(2048);
  });

  it("② 不设 ⇒ 请求体**不含** max_tokens（既有部署的行为逐字不变）", async () => {
    await provider().complete({ modelProvider: PROVIDER, modelId: "m", system: "s", user: "u" });
    // ⭐ 反证锚点：在实现里给它填一个硬编码默认值，这条立刻红。
    expect(lastBody).not.toHaveProperty("max_tokens");
  });

  it("环境变量读法：非法/零/负数一律当作没设，不是当作 0", () => {
    const read = (v: string | undefined) =>
      readModelProviderConfig({ KERNEL_MODEL_PROVIDER: "p", KERNEL_MODEL_BASE_URL: base, KERNEL_MODEL_API_KEY: "k", ...(v === undefined ? {} : { KERNEL_MODEL_MAX_OUTPUT_TOKENS: v }) } as NodeJS.ProcessEnv);
    expect(read("4096").maxOutputTokens).toBe(4096);
    expect(read(undefined).maxOutputTokens).toBeUndefined();
    for (const bad of ["", "0", "-1", "abc"]) expect(read(bad).maxOutputTokens).toBeUndefined();
  });

  it("finish_reason: length ⇒ 端口的 truncated 为 true；stop ⇒ 缺席（不是 false）", async () => {
    finishReason = "length";
    const cut = await provider().complete({ modelProvider: PROVIDER, modelId: "m", system: "s", user: "u" });
    expect(cut.truncated).toBe(true);
    finishReason = "stop";
    const ok = await provider().complete({ modelProvider: PROVIDER, modelId: "m", system: "s", user: "u" });
    // 缺席 = "provider 没报告"，与"报告了没截断"是两件事；调用方按 `=== true` 判。
    expect(ok).not.toHaveProperty("truncated");
  });
});
