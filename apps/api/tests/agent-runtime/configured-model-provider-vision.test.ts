/**
 * P2（#1561）—— `ConfiguredModelProvider` 的多模态请求体形态，用本地 stub HTTP 服务器验证。
 *
 * ## 为什么是 stub 而不是真实 DashScope
 *
 * #1561 硬性纪律：「测试不打真实外部 API」。这里要钉住的是**我们自己拼的请求体**：
 * 带图时 user 消息的 content 是不是 OpenAI 兼容的 part 数组、图是不是 data URL、
 * **不带图时是不是逐字节保持旧的纯字符串形态**（这条最重要——它保证一个没有图的
 * 部署完全不需要去验证"我们的上游认不认数组"）。真实模型名的可用性是另一件事，
 * 由 `apps/api/scripts/probe-bailian-vision.mjs` 在有 key 的环境单独出证据。
 */
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { ConfiguredModelProvider } from "../../src/infrastructure/agent-run/configured-model-provider";
import type { ModelCallInput } from "../../src/application/agent-run/ports";

let server: Server | null = null;

afterEach(async () => {
  if (server !== null) await new Promise<void>((r) => server?.close(() => r()));
  server = null;
});

async function startStub(): Promise<{ baseUrl: string; bodies: unknown[] }> {
  const bodies: unknown[] = [];
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += String(c); });
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { total_tokens: 5 } }));
    });
  });
  await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("stub server has no port");
  return { baseUrl: `http://127.0.0.1:${addr.port}`, bodies };
}

function provider(baseUrl: string, visionIds: readonly string[]): ConfiguredModelProvider {
  return new ConfiguredModelProvider({
    provider: "dashscope", baseUrl, apiKey: "stub-key", timeoutMs: 5_000,
    streamEnabled: false, visionModelIds: new Set(visionIds), thinkingDisableModelIds: new Set<string>(), bailianExtensionsEnabled: false,
  });
}

function input(overrides: Partial<ModelCallInput> = {}): ModelCallInput {
  return {
    modelProvider: "dashscope", modelId: "qwen-vl-max", system: "S", user: "图里画了什么？",
    ...overrides,
  };
}

describe("supportsVision —— 能力是模型的属性，不是厂商的属性", () => {
  it("只有配置在 visionModelIds 里的 modelId 才报 true；同 provider 的纯文本模型报 false", async () => {
    const { baseUrl } = await startStub();
    const p = provider(baseUrl, ["qwen-vl-max"]);
    expect(p.supportsVision("dashscope", "qwen-vl-max")).toBe(true);
    expect(p.supportsVision("dashscope", "qwen-plus")).toBe(false);
    // 不是本部署配置的 provider ⇒ false（那次调用本来就会以 NOT_CONFIGURED 失败）。
    expect(p.supportsVision("other-vendor", "qwen-vl-max")).toBe(false);
  });

  it("visionModelIds 为空（部署没配视觉模型）⇒ 一律 false，走诚实降级而不是赌", async () => {
    const { baseUrl } = await startStub();
    expect(provider(baseUrl, []).supportsVision("dashscope", "qwen-vl-max")).toBe(false);
  });
});

describe("请求体形态", () => {
  it("带图 → user content 是 part 数组，图是 data URL；system/history 仍是纯字符串", async () => {
    const { baseUrl, bodies } = await startStub();
    await provider(baseUrl, ["qwen-vl-max"]).complete(input({
      history: [{ role: "user", content: "上一轮" }],
      images: [{ filename: "a.png", mime: "image/png", bytes: new Uint8Array([1, 2, 3]) }],
    }));
    const body = bodies[0] as { messages: { role: string; content: unknown }[] };
    expect(body.messages[0]).toEqual({ role: "system", content: "S" });
    expect(body.messages[1]).toEqual({ role: "user", content: "上一轮" });
    const user = body.messages[2] as { role: string; content: unknown[] };
    expect(user.content[0]).toEqual({ type: "text", text: "图里画了什么？" });
    expect(user.content[1]).toEqual({
      type: "image_url",
      // Buffer.from([1,2,3]).toString("base64") === "AQID"
      image_url: { url: "data:image/png;base64,AQID" },
    });
  });

  it("不带图 → user content 仍是**纯字符串**（旧部署的请求体一个字节都没变）", async () => {
    const { baseUrl, bodies } = await startStub();
    await provider(baseUrl, ["qwen-vl-max"]).complete(input());
    const body = bodies[0] as { messages: { role: string; content: unknown }[] };
    expect(body.messages[body.messages.length - 1]).toEqual({
      role: "user", content: "图里画了什么？",
    });
  });

  it("images 是空数组（不是 undefined）时同样保持纯字符串——空不等于『有图』", async () => {
    const { baseUrl, bodies } = await startStub();
    await provider(baseUrl, ["qwen-vl-max"]).complete(input({ images: [] }));
    const body = bodies[0] as { messages: { role: string; content: unknown }[] };
    expect(typeof (body.messages[body.messages.length - 1] as { content: unknown }).content).toBe("string");
  });
});
