/**
 * #2504 —— pptx 任务提交后等待 300+ 秒超时。
 *
 * 根因见 `configured-model-provider.ts` 的 `postCompletions` 头注：这个部署配的是
 * 通义千问，Qwen3 系混合思考模型缺省开启深度思考，`complete()` 恒为 `stream: false`，
 * 调用方要等整段隐藏 reasoning + 正文都生成完才拿到响应——大 system prompt（pptx
 * skill）下这段等待被进一步拉长，叠加 #1611 已经放宽到的 180s 超时依然不够。
 *
 * 修法是对**已知支持关闭 thinking 的 modelId**（`config.thinkingDisableModelIds`），
 * 在非流式请求体里显式带 `enable_thinking: false`。**不是**对所有 provider/modelId
 * 无条件发这个字段——同作者复核诊断（PR #2640）指出：`enable_thinking` 是阿里云百炼
 * 的专有扩展字段，不是 OpenAI 标准字段，`postCompletions` 结构上是通用 adapter；
 * `thinking-only` 模型收到 `false` 会被拒绝而不是被忽略。这里直接检查上游收到的
 * 请求体，同时覆盖"在集合里 ⇒ 带字段"和"不在集合里 ⇒ 完全不带"两个方向——只测前者
 * 会让一个"无条件都发"的实现同样全绿，测不出这次收紧。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ConfiguredModelProvider } from "../../src/infrastructure/agent-run/configured-model-provider";
import { ModelCallError } from "../../src/application/agent-run/ports";

const PROVIDER = "i2504-loopback";
const API_KEY = "sk-i2504-secret-do-not-echo";
const ALLOWED_MODEL_ID = "qwen3.7-plus";
const OTHER_MODEL_ID = "some-other-model-not-in-allowlist";

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

function provider(streamEnabled: boolean, thinkingDisableModelIds: ReadonlySet<string>): ConfiguredModelProvider {
  return new ConfiguredModelProvider({
    provider: PROVIDER,
    baseUrl: base,
    apiKey: API_KEY,
    timeoutMs: 5_000,
    streamEnabled,
    visionModelIds: new Set<string>(),
    thinkingDisableModelIds,
  });
}

beforeAll(async () => { await startServer(); });
afterEach(() => { lastBody = null; });
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

describe("#2504 ConfiguredModelProvider 对已知混合思考 modelId 关闭非流式 thinking", () => {
  it("complete()（stream: false）+ modelId 在 thinkingDisableModelIds 里 ⇒ 请求体带 enable_thinking: false", async () => {
    const p = provider(false, new Set([ALLOWED_MODEL_ID]));
    await p.complete({ modelProvider: PROVIDER, modelId: ALLOWED_MODEL_ID, system: "s", user: "u" });

    expect(lastBody).not.toBeNull();
    expect(lastBody?.stream).toBe(false);
    // ⭐ 反证锚点：把 postCompletions 里的
    // `...(!stream && this.config.thinkingDisableModelIds.has(input.modelId) ? {...} : {})`
    // 删掉，这条立刻红。
    expect(lastBody?.enable_thinking).toBe(false);
  });

  it("complete()（stream: false）+ modelId 不在 thinkingDisableModelIds 里 ⇒ 请求体完全不带 enable_thinking", async () => {
    const p = provider(false, new Set([ALLOWED_MODEL_ID]));
    await p.complete({ modelProvider: PROVIDER, modelId: OTHER_MODEL_ID, system: "s", user: "u" });

    expect(lastBody).not.toBeNull();
    expect(lastBody?.stream).toBe(false);
    // ⭐ 反证锚点：把收紧后的门控换回"只看 stream"（对所有 modelId 无条件发），这条立刻红——
    // 这正是同作者复核诊断指出的"范围远超 #2504"风险的反证。
    expect(lastBody).not.toHaveProperty("enable_thinking");
  });

  it("completeStream()（stream: true）不带 enable_thinking——流式路径不在本次修复范围内", async () => {
    const p = provider(true, new Set([ALLOWED_MODEL_ID]));
    await p.completeStream?.({ modelProvider: PROVIDER, modelId: ALLOWED_MODEL_ID, system: "s", user: "u" }, async () => {});

    expect(lastBody).not.toBeNull();
    expect(lastBody?.stream).toBe(true);
    expect(lastBody).not.toHaveProperty("enable_thinking");
  });

  it("跨 provider 的调用在到达 postCompletions 之前就被拒绝——同一 modelId 字符串不能跨部署的 provider 身份泄漏 enable_thinking", async () => {
    // 复核诊断（PR #2640 独立复审）问的是：如果另一个部署配的 provider 不是这个
    // ConfiguredModelProvider 实例配置的那个（例如它自己的 provider 叫
    // "some-other-openai-compatible-vendor"），但调用时恰好也传了同一个允许集合里的
    // modelId 字符串（例如 "qwen3.7-plus" 这个名字被别的厂商复用），会不会也发出
    // enable_thinking？答案是不会——`complete()`/`completeStream()` 在触碰网络之前就先
    // 校验 `input.modelProvider === this.config.provider`，不匹配直接
    // `MODEL_PROVIDER_NOT_CONFIGURED`，`postCompletions`（连同它的 thinking 门控）根本
    // 不会被调用。`lastBody` 保持 `null` 是最强的证据：不是"发了但没带这个字段"，是
    // "压根没有发出任何 HTTP 请求"。
    const p = provider(false, new Set([ALLOWED_MODEL_ID]));

    await expect(p.complete({
      modelProvider: "some-other-openai-compatible-vendor",
      modelId: ALLOWED_MODEL_ID,
      system: "s",
      user: "u",
    })).rejects.toMatchObject({ code: "MODEL_PROVIDER_NOT_CONFIGURED" } satisfies Partial<ModelCallError>);

    expect(lastBody).toBeNull();
  });
});
