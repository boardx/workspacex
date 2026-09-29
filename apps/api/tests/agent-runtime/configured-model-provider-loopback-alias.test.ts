/**
 * 回环别名 × 真实 ConfiguredModelProvider：路由表把 `dashscope` 指到 chat 端口后，端口自己的
 * pin 校验也必须认这个别名（W029 frame stage 实测 `provider_not_configured` 的根因）。
 * 生产闸不变：baseUrl 非回环 ⇒ 别名一律不认；未传别名 ⇒ 仍诚实拒绝。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfiguredModelProvider } from "../../src/infrastructure/agent-run/configured-model-provider";
import { readLoopbackProviderAliases, withLoopbackProviderAliases } from "../../src/infrastructure/agent-run/loopback-provider-aliases";
import { RoutingModelCallPort } from "../../src/infrastructure/agent-run/routing-model-call-port";
import { ModelCallError, type ModelCallPort } from "../../src/application/agent-run/ports";

const PROVIDER = "fullstack-loopback";
let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "loopback-ok" }, finish_reason: "stop" }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

const config = (baseUrl: string) => ({
  provider: PROVIDER, baseUrl, apiKey: "sk-loop", timeoutMs: 5_000, streamEnabled: false,
  visionModelIds: new Set<string>(), thinkingDisableModelIds: new Set<string>(), bailianExtensionsEnabled: false,
});
const call = (modelProvider: string) => ({ modelProvider, modelId: "m", system: "s", user: "u" });

describe("ConfiguredModelProvider loopback aliases", () => {
  it("wired like kernel.module: a dashscope-pinned stage call completes on the loopback port", async () => {
    const cfg = config(base);
    const aliases = readLoopbackProviderAliases({ KERNEL_LOOPBACK_PROVIDER_ALIASES: "dashscope" }, cfg);
    const chatPort = new ConfiguredModelProvider(cfg, aliases);
    const router = new RoutingModelCallPort(new Map(withLoopbackProviderAliases<ModelCallPort>([[PROVIDER, chatPort]], aliases, chatPort)));
    await expect(router.complete(call("dashscope"))).resolves.toMatchObject({ text: "loopback-ok" });
    await expect(router.complete(call(PROVIDER))).resolves.toMatchObject({ text: "loopback-ok" });
  });

  it("no aliases ⇒ a foreign pin is still refused (no silent fallback)", async () => {
    await expect(new ConfiguredModelProvider(config(base)).complete(call("dashscope")))
      .rejects.toMatchObject({ code: "MODEL_PROVIDER_NOT_CONFIGURED" });
  });

  it("non-loopback baseUrl ⇒ aliases passed to the constructor are ignored", async () => {
    const p = new ConfiguredModelProvider(config("https://dashscope.aliyuncs.com/compatible-mode/v1"), ["dashscope"]);
    const err = await p.complete(call("dashscope")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelCallError);
    expect(err).toMatchObject({ code: "MODEL_PROVIDER_NOT_CONFIGURED" });
  });
});
