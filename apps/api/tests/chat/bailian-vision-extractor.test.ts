/**
 * #1560 · P1 —— `BailianVisionExtractor` 走**真实 HTTP**（本地 stub 上游）的适配层反证。
 *
 * 为什么用 stub 而不是打真百炼：本机没有 `KERNEL_MODEL_API_KEY`，打不了；而模型名是否可用**不能**
 * 用测试假装验证（那正是本仓禁止的"伪造响应"）。真实模型名验证由 `apps/api/scripts/probe-vision-model.mjs`
 * 在有 key 的环境单独出证据。这里能证、且必须证的是：请求形状对、每一类上游失败被如实分类、
 * 任何失败都**不产生**一份看起来成功的空产物。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import {
  BailianVisionExtractor, DEFAULT_VISION_MODEL_ID, readBailianVisionConfig,
} from "../../src/infrastructure/chat/bailian-vision-extractor";

interface StubReply { status: number; body: unknown }

let server: Server;
let baseUrl: string;
let nextReply: StubReply;
let requests: { path: string; body: any }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      requests.push({ path: req.url ?? "", body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      res.writeHead(nextReply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(nextReply.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(() => { requests = []; nextReply = { status: 200, body: {} }; });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

function extractor(over: Partial<ReturnType<typeof readBailianVisionConfig>> = {}) {
  return new BailianVisionExtractor({
    apiKey: "sk-test", modelId: "qwen-vl-test", baseUrl, timeoutMs: 5_000,
    maxImageBytes: 10 * 1024 * 1024, ...over,
  });
}

function okReply(text: string): StubReply {
  return { status: 200, body: { output: { choices: [{ message: { content: [{ text }] } }] } } };
}

describe("BailianVisionExtractor（真实 HTTP，stub 上游）", () => {
  it("成功：请求形状正确（模型名 + base64 data URL + 提问），产物是转录+描述 markdown", async () => {
    nextReply = okReply("【图中文字】\n登录\n【视觉描述】\n一张登录页截图");
    const r = await extractor().describeImage(PNG, "image/png");

    expect(requests).toHaveLength(1);
    expect(requests[0]!.path).toBe("/api/v1/services/aigc/multimodal-generation/generation");
    expect(requests[0]!.body.model).toBe("qwen-vl-test");
    const content = requests[0]!.body.input.messages[0].content;
    expect(content[0].image).toBe(`data:image/png;base64,${Buffer.from(PNG).toString("base64")}`);
    expect(String(content[1].text)).toContain("【图中文字】");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.modelId).toBe("qwen-vl-test"); // 如实是真实用的模型名，不是 stub 字样
    expect(r.markdown).toContain("登录");
    expect(r.markdown).toContain("一张登录页截图");
  });

  it("key 缺失 → visionNotConfigured，且**一个请求都不发**（不去撞一个必然失败的上游）", async () => {
    const r = await extractor({ apiKey: "" }).describeImage(PNG, "image/png");
    expect(r).toEqual({ ok: false, code: "visionNotConfigured" });
    expect(requests).toHaveLength(0);
  });

  it("模型名不存在（上游 400 + Model not exist）→ visionModelUnavailable，不换名重试", async () => {
    nextReply = { status: 400, body: { code: "InvalidParameter", message: "Model not exist." } };
    const r = await extractor().describeImage(PNG, "image/png");
    expect(r).toEqual({ ok: false, code: "visionModelUnavailable" });
    expect(requests).toHaveLength(1); // 只发了一次——没有"再试另一个模型名"的隐藏回落
  });

  it("401 → visionNotConfigured（key 无效），不是可重试的传输故障", async () => {
    nextReply = { status: 401, body: { message: "Invalid API-key provided." } };
    expect(await extractor().describeImage(PNG, "image/png")).toEqual({ ok: false, code: "visionNotConfigured" });
  });

  it("500 / 429 → visionTransport（可重试）", async () => {
    nextReply = { status: 500, body: { message: "internal" } };
    expect(await extractor().describeImage(PNG, "image/png")).toEqual({ ok: false, code: "visionTransport" });
    nextReply = { status: 429, body: { message: "throttled" } };
    expect(await extractor().describeImage(PNG, "image/png")).toEqual({ ok: false, code: "visionTransport" });
  });

  it("上游 200 但没有可用文本 → visionRejected，绝不返回空 markdown 冒充成功", async () => {
    nextReply = okReply("   ");
    const r = await extractor().describeImage(PNG, "image/png");
    expect(r).toEqual({ ok: false, code: "visionRejected" });
    expect((r as { markdown?: string }).markdown).toBeUndefined();
  });

  it("图片超上限 → visionImageTooLarge，本地就诚实拒，不发请求", async () => {
    const r = await extractor({ maxImageBytes: 4 }).describeImage(PNG, "image/png");
    expect(r).toEqual({ ok: false, code: "visionImageTooLarge" });
    expect(requests).toHaveLength(0);
  });

  it("上游不可达（连接被拒）→ visionTransport", async () => {
    const r = await extractor({ baseUrl: "http://127.0.0.1:1" }).describeImage(PNG, "image/png");
    expect(r).toEqual({ ok: false, code: "visionTransport" });
  });

  it("默认模型名来自 env，未设置时用**待实测确认**的默认值（不隐式换名）", () => {
    expect(readBailianVisionConfig({ KERNEL_VISION_MODEL_ID: "qwen-vl-plus" } as NodeJS.ProcessEnv).modelId)
      .toBe("qwen-vl-plus");
    expect(readBailianVisionConfig({} as NodeJS.ProcessEnv).modelId).toBe(DEFAULT_VISION_MODEL_ID);
  });
});
