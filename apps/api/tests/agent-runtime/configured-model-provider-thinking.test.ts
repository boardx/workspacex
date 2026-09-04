/**
 * #2504 —— pptx 任务提交后等待 300+ 秒超时。
 *
 * 根因见 `configured-model-provider.ts` 的 `postCompletions` 头注：这个部署配的是
 * 通义千问，Qwen3 系混合思考模型缺省开启深度思考，`complete()` 恒为 `stream: false`，
 * 调用方要等整段隐藏 reasoning + 正文都生成完才拿到响应——大 system prompt（pptx
 * skill）下这段等待被进一步拉长，叠加 #1611 已经放宽到的 180s 超时依然不够。
 *
 * 修法是**双维门控**都为真才在非流式请求体里带 `enable_thinking: false`：
 *   1. `thinkingDisableModelIds`（model 维度）—— 这个 modelId 是已知支持关闭 thinking
 *      的混合模型；
 *   2. `bailianExtensionsEnabled`（endpoint 维度）—— 这个部署配的端点真的是百炼，不是
 *      复用本类（通用 OpenAI-compatible adapter）指向别的厂商/自托管端点、只是恰好
 *      也用了同一个 modelId 字符串。
 *
 * 两轮独立复审诊断（PR #2640）逐步收紧到这个形状：
 *   - 第一轮指出"无条件对所有 provider/modelId 发"范围过宽；
 *   - 第二轮指出"只判 modelId 一维"仍不够——一个合法配置的非百炼 provider，只要
 *     provider 名对得上（不触发 `MODEL_PROVIDER_NOT_CONFIGURED`）且 modelId 字符串
 *     恰好复用了默认允许集合里的名字，旧实现依然会误发。
 *
 * 下面的用例覆盖四个方向：① 双维都满足 ⇒ 带字段；② model 维度不满足 ⇒ 不带；
 * ③ endpoint 维度不满足（即使 provider 名合法匹配、modelId 也在允许集合里）⇒ 不带；
 * ④ stream ⇒ 不带。只测 ①② 会让一个"没有 endpoint 维度"的实现同样全绿，测不出第二轮
 * 收紧；额外补一条"跨 provider 调用连网络请求都不会发出"的反证，钉住 provider 校验发生
 * 在 `postCompletions` 之前这个结构性事实。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ConfiguredModelProvider,
  readBailianExtensionsEnabled,
} from "../../src/infrastructure/agent-run/configured-model-provider";
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

function provider(opts: {
  streamEnabled: boolean;
  thinkingDisableModelIds: ReadonlySet<string>;
  bailianExtensionsEnabled: boolean;
}): ConfiguredModelProvider {
  return new ConfiguredModelProvider({
    provider: PROVIDER,
    baseUrl: base,
    apiKey: API_KEY,
    timeoutMs: 5_000,
    streamEnabled: opts.streamEnabled,
    visionModelIds: new Set<string>(),
    thinkingDisableModelIds: opts.thinkingDisableModelIds,
    bailianExtensionsEnabled: opts.bailianExtensionsEnabled,
  });
}

beforeAll(async () => { await startServer(); });
afterEach(() => { lastBody = null; });
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

describe("#2504 ConfiguredModelProvider 对已知混合思考 modelId + 百炼 endpoint 双维门控关闭非流式 thinking", () => {
  it("① model 维度满足 + endpoint 维度满足（stream: false）⇒ 请求体带 enable_thinking: false", async () => {
    const p = provider({
      streamEnabled: false,
      thinkingDisableModelIds: new Set([ALLOWED_MODEL_ID]),
      bailianExtensionsEnabled: true,
    });
    await p.complete({ modelProvider: PROVIDER, modelId: ALLOWED_MODEL_ID, system: "s", user: "u" });

    expect(lastBody).not.toBeNull();
    expect(lastBody?.stream).toBe(false);
    // ⭐ 反证锚点：把 postCompletions 里的双维 `&&` 门控删掉任意一半，这条立刻红。
    expect(lastBody?.enable_thinking).toBe(false);
  });

  it("② model 维度不满足（modelId 不在 thinkingDisableModelIds 里，即使 endpoint 维度满足）⇒ 请求体完全不带 enable_thinking", async () => {
    const p = provider({
      streamEnabled: false,
      thinkingDisableModelIds: new Set([ALLOWED_MODEL_ID]),
      bailianExtensionsEnabled: true,
    });
    await p.complete({ modelProvider: PROVIDER, modelId: OTHER_MODEL_ID, system: "s", user: "u" });

    expect(lastBody).not.toBeNull();
    expect(lastBody?.stream).toBe(false);
    expect(lastBody).not.toHaveProperty("enable_thinking");
  });

  it("③ endpoint 维度不满足（合法匹配的非百炼 provider + 同一 allowlisted modelId，即使 model 维度满足）⇒ 请求体完全不带 enable_thinking", async () => {
    // 这是第二轮独立复审诊断点名要求的场景：provider 名合法匹配本实例配置（不会被
    // MODEL_PROVIDER_NOT_CONFIGURED 拒绝），modelId 也在允许集合里，但这个部署的
    // baseUrl 不是百炼——`bailianExtensionsEnabled: false` 显式声明了这一点。旧实现
    // （只判 modelId 一维）会在这里误发；双维实现不会。
    const p = provider({
      streamEnabled: false,
      thinkingDisableModelIds: new Set([ALLOWED_MODEL_ID]),
      bailianExtensionsEnabled: false,
    });
    await p.complete({ modelProvider: PROVIDER, modelId: ALLOWED_MODEL_ID, system: "s", user: "u" });

    expect(lastBody).not.toBeNull();
    expect(lastBody?.stream).toBe(false);
    // ⭐ 反证锚点：把门控退回到只看 thinkingDisableModelIds（不看 bailianExtensionsEnabled），
    // 这条立刻红——这正是第二轮复审诊断指出的"合法跨 endpoint 配置会 omission"风险的反证。
    expect(lastBody).not.toHaveProperty("enable_thinking");
  });

  it("④ stream: true ⇒ 请求体不带 enable_thinking——流式路径不在本次修复范围内", async () => {
    const p = provider({
      streamEnabled: true,
      thinkingDisableModelIds: new Set([ALLOWED_MODEL_ID]),
      bailianExtensionsEnabled: true,
    });
    await p.completeStream?.({ modelProvider: PROVIDER, modelId: ALLOWED_MODEL_ID, system: "s", user: "u" }, async () => {});

    expect(lastBody).not.toBeNull();
    expect(lastBody?.stream).toBe(true);
    expect(lastBody).not.toHaveProperty("enable_thinking");
  });

  it("跨 provider 的调用在到达 postCompletions 之前就被拒绝——同一 modelId 字符串不能跨部署的 provider 身份泄漏 enable_thinking", async () => {
    // 第一轮独立复审诊断问的是：如果另一个部署配的 provider 不是这个 ConfiguredModelProvider
    // 实例配置的那个（例如它自己的 provider 叫 "some-other-openai-compatible-vendor"），
    // 但调用时恰好也传了同一个允许集合里的 modelId 字符串，会不会也发出 enable_thinking？
    // 答案是不会——`complete()`/`completeStream()` 在触碰网络之前就先校验
    // `input.modelProvider === this.config.provider`，不匹配直接
    // `MODEL_PROVIDER_NOT_CONFIGURED`，`postCompletions`（连同它的双维门控）根本不会被
    // 调用。`lastBody` 保持 `null` 是最强的证据：不是"发了但没带这个字段"，是"压根没有
    // 发出任何 HTTP 请求"。（这条只覆盖"provider 名不匹配"这一半；"provider 名匹配但
    // endpoint 不是百炼"那一半由上面的 ③ 覆盖——两条都留着，互不替代。）
    const p = provider({
      streamEnabled: false,
      thinkingDisableModelIds: new Set([ALLOWED_MODEL_ID]),
      bailianExtensionsEnabled: true,
    });

    await expect(p.complete({
      modelProvider: "some-other-openai-compatible-vendor",
      modelId: ALLOWED_MODEL_ID,
      system: "s",
      user: "u",
    })).rejects.toMatchObject({ code: "MODEL_PROVIDER_NOT_CONFIGURED" } satisfies Partial<ModelCallError>);

    expect(lastBody).toBeNull();
  });
});

describe("#2504 readBailianExtensionsEnabled —— endpoint 维度的判定逻辑本身", () => {
  it("baseUrl 命中真实百炼 host（dashscope.aliyuncs.com）⇒ true，无需环境变量", () => {
    expect(readBailianExtensionsEnabled({}, "https://dashscope.aliyuncs.com/compatible-mode/v1")).toBe(true);
  });

  it("baseUrl 是别的端点（自托管/其它厂商）⇒ 默认 false，不是裸猜", () => {
    expect(readBailianExtensionsEnabled({}, "https://my-self-hosted-vllm.internal/v1")).toBe(false);
    expect(readBailianExtensionsEnabled({}, "")).toBe(false);
  });

  it("KERNEL_MODEL_BAILIAN_EXTENSIONS 显式覆盖优先于 baseUrl 判定", () => {
    expect(readBailianExtensionsEnabled(
      { KERNEL_MODEL_BAILIAN_EXTENSIONS: "0" },
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    )).toBe(false);
    expect(readBailianExtensionsEnabled(
      { KERNEL_MODEL_BAILIAN_EXTENSIONS: "1" },
      "https://my-self-hosted-vllm.internal/v1",
    )).toBe(true);
  });

  // 第三轮独立复审诊断：子串匹配（`baseUrl.includes("dashscope.aliyuncs.com")`）会被
  // 伪造子域或藏在 path/query 里的同一段字符串骗过，必须严格按 URL.hostname 判定。
  it("伪造子域（真实字符串出现在攻击者控制的子域里）⇒ false，不是子串匹配意义上的『命中』", () => {
    expect(readBailianExtensionsEnabled({}, "https://dashscope.aliyuncs.com.attacker.example/v1")).toBe(false);
  });

  it("字符串藏在 path/query 而不是 host 里 ⇒ false", () => {
    expect(readBailianExtensionsEnabled({}, "https://evil.example/dashscope.aliyuncs.com")).toBe(false);
    expect(readBailianExtensionsEnabled({}, "https://evil.example/v1?upstream=dashscope.aliyuncs.com")).toBe(false);
  });

  it("baseUrl 不是合法 URL（解析失败）⇒ fail closed 为 false，不是抛异常或裸猜", () => {
    expect(readBailianExtensionsEnabled({}, "not a url at all")).toBe(false);
    expect(readBailianExtensionsEnabled({}, "dashscope.aliyuncs.com")).toBe(false); // 缺 scheme，URL() 解析失败
  });

  it("带 www. 前缀的真实百炼 host 仍判 true（生产环境两种写法都可能出现）", () => {
    expect(readBailianExtensionsEnabled({}, "https://www.dashscope.aliyuncs.com/compatible-mode/v1")).toBe(true);
  });
});
