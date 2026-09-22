/** #3749 B1.4: `responseSchema` reaches the wire only behind KERNEL_MODEL_JSON_SCHEMA=1. */
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
