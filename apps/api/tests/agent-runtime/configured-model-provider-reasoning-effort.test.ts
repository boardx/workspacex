/**
 * KERNEL_MODEL_REASONING_EFFORT -> `reasoning_effort` on the request body. WorkspaceX Local sends
 * `none` to switch Qwen3.5 thinking off on Ollama >= 0.34 (measured 2026-09-17); unset = not sent.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ConfiguredModelProvider, readModelProviderConfig } from "../../src/infrastructure/agent-run/configured-model-provider";

const PROVIDER = "reasoning-effort-loopback";
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

const provider = (reasoningEffort?: string) =>
  new ConfiguredModelProvider({
    provider: PROVIDER, baseUrl: base, apiKey: "sk-iter12", timeoutMs: 5_000, streamEnabled: false,
    visionModelIds: new Set<string>(), thinkingDisableModelIds: new Set<string>(), bailianExtensionsEnabled: false,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  });

describe("KERNEL_MODEL_REASONING_EFFORT", () => {
  it("set -> the request body carries reasoning_effort verbatim", async () => {
    await provider("none").complete({ modelProvider: PROVIDER, modelId: "m", system: "s", user: "u" });
    expect(lastBody?.reasoning_effort).toBe("none");
  });
  it("unset -> the body has no reasoning_effort at all (existing deployments unchanged)", async () => {
    await provider().complete({ modelProvider: PROVIDER, modelId: "m", system: "s", user: "u" });
    expect(lastBody).not.toHaveProperty("reasoning_effort");
  });
  it("readModelProviderConfig: trims, and an empty value means unset", () => {
    const read = (v: string | undefined) => readModelProviderConfig({ KERNEL_MODEL_BASE_URL: "http://x", ...(v === undefined ? {} : { KERNEL_MODEL_REASONING_EFFORT: v }) } as NodeJS.ProcessEnv);
    expect(read(" none ").reasoningEffort).toBe("none");
    expect(read("").reasoningEffort).toBeUndefined();
    expect(read(undefined).reasoningEffort).toBeUndefined();
  });
});
