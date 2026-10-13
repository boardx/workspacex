import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ConfiguredModelProvider } from "../../src/infrastructure/agent-run/configured-model-provider";
import { ModelCallError } from "../../src/application/agent-run/ports";
let status = 400; let body: unknown;
let eventStream = false;
const server = createServer((request, response) => {
  request.resume();
  response.writeHead(status, { "content-type": eventStream ? "text/event-stream" : "application/json" });
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
  [200, {choices:[{message:{content:null},finish_reason:"content_filter"}],usage:{prompt_tokens:12}}, "content-rejected"],
  [200, {choices:[{message:{content:"DO_NOT_RETAIN_BODY"},finish_reason:"content_filter"}],usage:{prompt_tokens:12}}, "content-rejected"],
  [200, {choices:[{message:{content:""},finish_reason:"content_filter"}],usage:{prompt_tokens:12}}, "content-rejected"],
  [200, {choices:[{message:{content:null},finish_reason:"stop"}]}, undefined],
  [200, {choices:[{message:{content:""},finish_reason:"stop"}]}, undefined],
  [200, {choices:[{message:{content:null},finish_reason:"unknown_filter"}]}, undefined],
])("classifies only the exact provider protocol rejection (%s)", async (httpStatus, responseBody, disposition) => {
  status=httpStatus as number; body=responseBody;
  const error=await provider.complete({modelProvider:"test",modelId:"model",system:"Research",user:"Input"}).catch(error=>error);
  expect(error).toBeInstanceOf(ModelCallError);
  expect(error.retryDisposition).toBe(disposition === "content-rejected" ? undefined : disposition);
  expect(error.contentRejection).toBe(disposition === "content-rejected" ? "content-policy" : undefined);
  expect(JSON.stringify(error)).not.toContain("DO_NOT_RETAIN_BODY");
  if(disposition==="content-rejected") expect(error.usage.prompt).toBe(12);
});
it("does not classify ordinary successful text containing a filter token as a refusal", async () => {
  status=200; body={choices:[{message:{content:"content_filter is a protocol value"},finish_reason:"stop"}]};
  const result=await provider.complete({modelProvider:"test",modelId:"model",system:"Research",user:"Input"});
  expect(result.text).toBe("content_filter is a protocol value");
});
it.each([null,"","DO_NOT_RETAIN_BODY"])("rejects a filtered stream without returning its final delta (%s)", async content => {
  status=200; eventStream=true;
  body=`data: ${JSON.stringify({choices:[{delta:{content},finish_reason:"content_filter"}],usage:{prompt_tokens:12,completion_tokens:0}})}\n\ndata: [DONE]\n\n`;
  const streaming=new ConfiguredModelProvider({provider:"test",baseUrl:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,apiKey:"test-only",timeoutMs:1000,streamEnabled:true,visionModelIds:new Set(),thinkingDisableModelIds:new Set(),bailianExtensionsEnabled:false});
  const deltas:string[]=[];
  try {
    const error=await streaming.completeStream!({modelProvider:"test",modelId:"model",system:"Research",user:"Input"},async delta=>{deltas.push(delta);}).catch(error=>error);
    expect(error).toBeInstanceOf(ModelCallError);
    expect(error.contentRejection).toBe("content-policy");
    expect(error.usage).toMatchObject({prompt:12,completion:0});
    expect(error.retryDisposition).toBeUndefined();
    expect(deltas).toEqual([]);
    expect(JSON.stringify(error)).not.toContain("DO_NOT_RETAIN_BODY");
  } finally {eventStream=false;}
});

it("does not return a successful stream after an earlier partial delta and terminal filtering", async () => {
  status=200; eventStream=true;
  body='data: '+JSON.stringify({choices:[{delta:{content:"Earlier partial"}}]})+'\n\n'+'data: '+JSON.stringify({choices:[{delta:{},finish_reason:"content_filter"}],usage:{prompt_tokens:12,completion_tokens:3}})+'\n\ndata: [DONE]\n\n';
  const streaming=new ConfiguredModelProvider({provider:"test",baseUrl:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,apiKey:"test-only",timeoutMs:1000,streamEnabled:true,visionModelIds:new Set(),thinkingDisableModelIds:new Set(),bailianExtensionsEnabled:false});
  const deltas:string[]=[];
  try {
    const error=await streaming.completeStream!({modelProvider:"test",modelId:"model",system:"Research",user:"Input"},async delta=>{deltas.push(delta);}).catch(error=>error);
    expect(error).toBeInstanceOf(ModelCallError);
    expect(error.contentRejection).toBe("content-policy");
    expect(error.usage).toMatchObject({prompt:12,completion:3});
    expect(deltas).toEqual(["Earlier partial"]);
    expect(JSON.stringify(error)).not.toContain("Earlier partial");
  } finally {eventStream=false;}
});
