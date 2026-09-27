import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConfiguredModelProvider, readModelProviderConfig } from "../../src/infrastructure/agent-run/configured-model-provider";
import { ModelDesignChatReplier, isTransientModelFailure, type DesignChatContext } from "../../src/application/design-workbench/design-chat-model";

/**
 * 用户实测（2026-09-27）：新建项目第一次生成就失败——「调用 AI 模型失败（网络或鉴权）」，发送与失败同一分钟，
 * 再发一次就好了。上游偶发的 5xx / 429 原来一次就判死。
 *
 * ⚠ 错误**不手抄**：全部由真的 `ConfiguredModelProvider` 对着一个本地假上游产生——瞬时判据解析的是
 *   provider 自己写的 detail，provider 改了文案这里就红，不会让重试分支静默变成死代码。
 */
let server: http.Server; let port = 0;
let plan: number[] = [];   // 每次请求依次回的 HTTP 状态；用完之后一律 200
let hits = 0;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      hits += 1;
      const status = plan.shift() ?? 200;
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(status === 200
        ? JSON.stringify({ choices: [{ message: { role: "assistant", content: "{\"reply\":\"好的，改好了。\"}" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
        : JSON.stringify({ error: { message: "upstream says no" } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
});
afterAll(() => server.close());
beforeEach(() => { plan = []; hits = 0; });

const provider = () => new ConfiguredModelProvider(readModelProviderConfig({
  KERNEL_MODEL_PROVIDER: "ollama", KERNEL_MODEL_BASE_URL: `http://127.0.0.1:${port}/v1`, KERNEL_MODEL_API_KEY: "k",
} as NodeJS.ProcessEnv));
async function errorFor(status: number): Promise<unknown> {
  plan = [status];
  return provider().complete({ modelProvider: "ollama", modelId: "m", system: "s", user: "u" }).then(() => null, (e: unknown) => e);
}

describe("瞬时判据（错误由真 provider 产生）", () => {
  it("503 / 502 / 429 是瞬时的；401 / 403 / 400 不是", async () => {
    for (const s of [503, 502, 429]) expect(isTransientModelFailure(await errorFor(s)), `HTTP ${String(s)}`).toBe(true);
    for (const s of [401, 403, 400]) expect(isTransientModelFailure(await errorFor(s)), `HTTP ${String(s)}`).toBe(false);
  });
  it("连不上（传输失败）是瞬时的", async () => {
    const dead = new ConfiguredModelProvider(readModelProviderConfig({
      KERNEL_MODEL_PROVIDER: "ollama", KERNEL_MODEL_BASE_URL: "http://127.0.0.1:9/v1", KERNEL_MODEL_API_KEY: "k",
    } as NodeJS.ProcessEnv));
    const e = await dead.complete({ modelProvider: "ollama", modelId: "m", system: "s", user: "u" }).then(() => null, (x: unknown) => x);
    expect(isTransientModelFailure(e)).toBe(true);
  });
});

describe("设计对话遇到瞬时失败自动再试一次", () => {
  // 已有原型 ⇒ 走单次调用那条路（首次生成的分页路径共用同一个 callModel）。
  const ctx: DesignChatContext = {
    name: "白板", template: "ui", problem: "做一个白板", criteria: [], frames: ["首页"],
    prototype: [{ id: "n1", type: "stack", children: [{ id: "n2", type: "text", props: { content: "占位" } }] }],
    chat: [{ role: "user", text: "把标题改大一点", at: "2026-09-27T00:00:00.000Z" }],
  } as never;
  const replier = () => new ModelDesignChatReplier({ model: provider(), chatModel: { provider: "ollama", modelId: "m" }, log: () => undefined });

  it("⭐ 反证锚点：第一次 503、第二次正常 ⇒ 用户拿到的是模型的回复，不是失败", async () => {
    plan = [503];
    const out = await replier().reply(ctx);
    expect(hits).toBe(2);
    expect(out.source).toBe("model");
    expect(out.text).toContain("改好了");
  });

  it("鉴权失败（401）⇒ 不重试，照旧如实报失败", async () => {
    plan = [401];
    const out = await replier().reply(ctx);
    expect(hits).toBe(1);
    expect(out.source).toBe("fallback");
  });

  it("连续两次瞬时失败 ⇒ 只再试一次，不无限重试", async () => {
    plan = [503, 503];
    const out = await replier().reply(ctx);
    expect(hits).toBe(2);
    expect(out.source).toBe("fallback");
  });
});
