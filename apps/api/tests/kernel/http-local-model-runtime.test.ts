/**
 * #3749 B1.5: the personal-local runtime must speak Ollama's `/api/generate` for real --
 * `model` on the request, `stream:false`, and the `response` field back as the completion.
 * The first cut sent `{ prompt }` alone (HTTP 400 on Ollama) and returned the raw body.
 */
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpLocalModelRuntime, localRuntimeModelId } from "../../src/infrastructure/identity/http-local-model-runtime";

let server: http.Server; let port = 0; const seen: unknown[] = [];
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { model?: string; stream?: boolean };
      seen.push(body);
      if (!body.model) { res.statusCode = 400; res.end(JSON.stringify({ error: "model is required" })); return; }
      res.end(JSON.stringify({ model: body.model, response: "本地回答", done: true }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
});
afterAll(() => server.close());

describe("HttpLocalModelRuntime.complete", () => {
  it("sends model + stream:false and returns the response text", async () => {
    const rt = new HttpLocalModelRuntime(`http://127.0.0.1:${port}`, "qwen3.5:4b");
    expect(await rt.complete("你好")).toBe("本地回答");
    expect(seen.at(-1)).toMatchObject({ model: "qwen3.5:4b", prompt: "你好", stream: false });
  });
  it("surfaces the runtime's error instead of returning the raw body", async () => {
    const rt = new HttpLocalModelRuntime(`http://127.0.0.1:${port}`, "");
    await expect(rt.complete("x")).rejects.toThrow(/local runtime error: model is required/);
  });
  it("resolves the model id from LOCAL_RUNTIME_MODEL_ID, then KERNEL_MODEL_ID", () => {
    expect(localRuntimeModelId({ LOCAL_RUNTIME_MODEL_ID: "a", KERNEL_MODEL_ID: "b" } as NodeJS.ProcessEnv)).toBe("a");
    expect(localRuntimeModelId({ KERNEL_MODEL_ID: "b" } as NodeJS.ProcessEnv)).toBe("b");
    expect(localRuntimeModelId({} as NodeJS.ProcessEnv)).toBe("");
  });
});
