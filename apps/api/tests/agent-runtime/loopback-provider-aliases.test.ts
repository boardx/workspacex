/**
 * 回环/开发/CI 栈：官方角色包钉的 `dashscope` 路由到已配置的回环 chat provider；
 * 生产配置（远端 baseUrl / 未设 env / 真的注册了 dashscope）一律不受影响。
 */
import { describe, expect, it } from "vitest";
import { readLoopbackProviderAliases, withLoopbackProviderAliases } from "../../src/infrastructure/agent-run/loopback-provider-aliases";
import { RoutingModelCallPort } from "../../src/infrastructure/agent-run/routing-model-call-port";
import { ModelCallError, type ModelCallInput, type ModelCallPort } from "../../src/application/agent-run/ports";

function port(label: string): ModelCallPort {
  return { complete: async () => ({ text: label }) } as unknown as ModelCallPort;
}
const input = (modelProvider: string) => ({ modelProvider, modelId: "m", system: "", messages: [] } as unknown as ModelCallInput);

function route(env: NodeJS.ProcessEnv, chat: { provider: string; baseUrl: string }, extra: Array<readonly [string, ModelCallPort]> = []) {
  const chatPort = port("chat");
  return new RoutingModelCallPort(new Map(withLoopbackProviderAliases<ModelCallPort>(
    [[chat.provider, chatPort], ...extra], readLoopbackProviderAliases(env, chat), chatPort)));
}

const LOOPBACK = { provider: "fullstack-loopback", baseUrl: "http://127.0.0.1:4010" };

describe("loopback provider aliases", () => {
  it("回环模式：dashscope 钉死的 agent run 走回环 provider", async () => {
    const router = route({ KERNEL_LOOPBACK_PROVIDER_ALIASES: "dashscope" }, LOOPBACK);
    await expect(router.complete(input("dashscope"))).resolves.toMatchObject({ text: "chat" });
  });

  it("生产：未设 env ⇒ dashscope 仍诚实 MODEL_PROVIDER_NOT_CONFIGURED", async () => {
    const router = route({}, LOOPBACK);
    await expect(router.complete(input("dashscope"))).rejects.toBeInstanceOf(ModelCallError);
  });

  it("生产：baseUrl 指向远端 ⇒ 别名 env 被忽略", () => {
    expect(readLoopbackProviderAliases({ KERNEL_LOOPBACK_PROVIDER_ALIASES: "dashscope" },
      { provider: "openai-compat", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" })).toEqual([]);
    expect(readLoopbackProviderAliases({ KERNEL_LOOPBACK_PROVIDER_ALIASES: "dashscope" },
      { provider: "x", baseUrl: "https://127.0.0.1.evil.example" })).toEqual([]);
  });

  it("已注册的真实 provider 永不被别名覆盖", async () => {
    const router = route({ KERNEL_LOOPBACK_PROVIDER_ALIASES: "dashscope,deep-agent" }, LOOPBACK, [["deep-agent", port("real")]]);
    await expect(router.complete(input("deep-agent"))).resolves.toMatchObject({ text: "real" });
    await expect(router.complete(input("dashscope"))).resolves.toMatchObject({ text: "chat" });
  });
});
