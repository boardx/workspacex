import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ConfiguredModelProvider } from "../../src/infrastructure/agent-run/configured-model-provider";
import { ModelCallError } from "../../src/application/agent-run/ports";
let status = 400; let body: unknown;
const server = createServer((request, response) => {
  request.resume();
  response.writeHead(status, { "content-type": "application/json" });
  response.end(typeof body === "string" ? body : JSON.stringify(body));
});
let provider: ConfiguredModelProvider;
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  provider = new ConfiguredModelProvider({ provider: "test", baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, apiKey: "test-only", timeoutMs: 1000, streamEnabled: false, visionModelIds: new Set(), thinkingDisableModelIds: new Set(), bailianExtensionsEnabled: false });
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
it.each([
  [400, {error:{code:"data_inspection_failed",message:"DO_NOT_RETAIN_BODY"},usage:{prompt_tokens:12}}, "content-rejected"],
  [400, {error:{code:"invalid_parameter",message:"data_inspection_failed"}}, undefined],
  [401, {error:{code:"data_inspection_failed"}}, undefined],
  [429, {error:{code:"data_inspection_failed"}}, "rate-limited"],
  [503, {error:{code:"data_inspection_failed"}}, "temporarily-unavailable"],
  [400, "not JSON", undefined],
])("classifies only the exact provider protocol rejection (%s)", async (httpStatus, responseBody, disposition) => {
  status=httpStatus as number; body=responseBody;
  const error=await provider.complete({modelProvider:"test",modelId:"model",system:"Research",user:"Input"}).catch(error=>error);
  expect(error).toBeInstanceOf(ModelCallError);
  expect(error.retryDisposition).toBe(disposition === "content-rejected" ? undefined : disposition);
  expect(error.contentRejection).toBe(disposition === "content-rejected" ? "content-policy" : undefined);
  expect(JSON.stringify(error)).not.toContain("DO_NOT_RETAIN_BODY");
  if(disposition==="content-rejected") expect(error.usage.prompt).toBe(12);
});
