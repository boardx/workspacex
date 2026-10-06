/** #3749 B1.4: `responseSchema` reaches the wire only behind KERNEL_MODEL_JSON_SCHEMA=1. */
import http from "node:http";
import { fetch as providerFetch } from "undici";
vi.mock("undici", async () => { const actual = await vi.importActual<typeof import("undici")>("undici"); return { ...actual, fetch: vi.fn(actual.fetch) }; });
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ConfiguredModelProvider, readModelProviderConfig } from "../../src/infrastructure/agent-run/configured-model-provider";
import { FOLLOWUP_SUGGESTIONS_RESPONSE_SCHEMA, parseFollowUpSuggestions } from "../../src/application/chat/generate-followup-suggestions";

let server: http.Server; let port = 0; const bodies: Record<string, unknown>[] = [];
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "{\"suggestions\":[\"a\",\"b\"]}" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
});
afterAll(() => server.close());

const env = (extra: Record<string, string>) => ({ KERNEL_MODEL_PROVIDER: "ollama", KERNEL_MODEL_BASE_URL: `http://127.0.0.1:${port}/v1`, KERNEL_MODEL_API_KEY: "k", ...extra }) as NodeJS.ProcessEnv;
const input = { modelProvider: "ollama", modelId: "m", system: "s", user: "u", responseSchema: FOLLOWUP_SUGGESTIONS_RESPONSE_SCHEMA };

describe("response_format json_schema", () => {
  it("is sent when the switch is on and the call carries a schema", async () => {
    const p = new ConfiguredModelProvider(readModelProviderConfig(env({ KERNEL_MODEL_JSON_SCHEMA: "1" })));
    const out = await p.complete(input);
    expect(parseFollowUpSuggestions(out.text)).toEqual(["a", "b"]);
    expect(bodies.at(-1)?.response_format).toEqual({ type: "json_schema", json_schema: { name: "followup_suggestions", schema: FOLLOWUP_SUGGESTIONS_RESPONSE_SCHEMA.schema } });
  });
  it("is absent without the switch (request byte-identical to before)", async () => {
    const p = new ConfiguredModelProvider(readModelProviderConfig(env({})));
    await p.complete(input);
    expect(bodies.at(-1)).not.toHaveProperty("response_format");
  });
  it("is absent when the call has no schema even with the switch on", async () => {
    const p = new ConfiguredModelProvider(readModelProviderConfig(env({ KERNEL_MODEL_JSON_SCHEMA: "1" })));
    await p.complete({ modelProvider: "ollama", modelId: "m", system: "s", user: "u" });
    expect(bodies.at(-1)).not.toHaveProperty("response_format");
  });
});

describe("parseFollowUpSuggestions", () => {
  it("accepts the bare array form and the constrained object form", () => {
    expect(parseFollowUpSuggestions("好的：[\"x\",\"y\"]")).toEqual(["x", "y"]);
    expect(parseFollowUpSuggestions("{\"suggestions\":[\"x\"]}")).toEqual(["x"]);
    expect(parseFollowUpSuggestions("nothing here")).toEqual([]);
  });
});


describe("trusted per-call strict schema capability", () => {
  const supported = "https://llm-fixture.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";
  const schemaInput = { ...input, modelId: "qwen3.8-max", responseSchema: { ...FOLLOWUP_SUGGESTIONS_RESPONSE_SCHEMA, policy: "strict-if-supported" as const } };
  async function call(baseUrl: string, modelId = schemaInput.modelId, policy = true, flag = false) {
    vi.mocked(providerFetch).mockImplementationOnce((_url, options) => providerFetchOriginal(`http://127.0.0.1:${port}/v1/chat/completions`, options));
    const p = new ConfiguredModelProvider({ ...readModelProviderConfig(env({ KERNEL_MODEL_JSON_SCHEMA: flag ? "1" : "0" })), baseUrl });
    const before = bodies.length;
    try { await p.complete({ ...schemaInput, modelId, responseSchema: policy ? schemaInput.responseSchema : FOLLOWUP_SUGGESTIONS_RESPONSE_SCHEMA }); expect(bodies).toHaveLength(before + 1); return bodies.at(-1)!; }
    finally { p.close(); }
  }
  let providerFetchOriginal: typeof providerFetch;
  beforeAll(async () => { providerFetchOriginal = (await vi.importActual<typeof import("undici")>("undici")).fetch; });
  it("sends strict schema for the supported Beijing model even when the global flag is off", async () => {
    const body = await call(supported);
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: FOLLOWUP_SUGGESTIONS_RESPONSE_SCHEMA.name, schema: FOLLOWUP_SUGGESTIONS_RESPONSE_SCHEMA.schema, strict: true } });
    expect(body).not.toHaveProperty("policy");
  });
  it.each([
    ["https://llm-fixture.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", "qwen3.8-max"],
    ["https://llm-fixture.cn-beijing.maas.aliyuncs.com/other/v1", "qwen3.8-max"],
    ["https://llm-fixture.cn-beijing.maas.aliyuncs.com.attacker.example/compatible-mode/v1", "qwen3.8-max"],
    [supported, "qwen-plus"], ["https://example.org/compatible-mode/v1", "qwen3.8-max"],
  ])("does not infer schema capability for %s / %s", async (baseUrl, modelId) => {
    expect(await call(baseUrl, modelId)).not.toHaveProperty("response_format");
  });
  it("keeps a supported endpoint's no-policy flag-off request unchanged", async () => {
    expect(await call(supported, "qwen3.8-max", false)).not.toHaveProperty("response_format");
  });
  it("rejects an unconfigured provider before any HTTP call even on a supported endpoint", async () => {
    const p = new ConfiguredModelProvider({ ...readModelProviderConfig(env({})), baseUrl: supported });
    const before = vi.mocked(providerFetch).mock.calls.length;
    try {
      await expect(p.complete({ ...schemaInput, modelProvider: "unconfigured-provider" })).rejects.toMatchObject({ code: "MODEL_PROVIDER_NOT_CONFIGURED" });
      expect(vi.mocked(providerFetch).mock.calls).toHaveLength(before);
    } finally { p.close(); }
  });
  it("preserves legacy flag-on behavior for unknown endpoints and models", async () => {
    const body = await call("https://example.org/v1", "unknown-model", true, true);
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: FOLLOWUP_SUGGESTIONS_RESPONSE_SCHEMA.name, schema: FOLLOWUP_SUGGESTIONS_RESPONSE_SCHEMA.schema } });
  });
});
