import { afterEach, expect, it, vi } from "vitest";
import { DeepAgentModelProvider } from "../../src/infrastructure/agent-run/deep-agent-model-provider";
afterEach(() => vi.unstubAllGlobals());
it.each([false, true])("forwards executor-owned identity on fresh/resume=%s without a listener", async resume => {
  const bodies: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url.endsWith("/runs")) bodies.push(JSON.parse(String(init.body)));
    const body = url.endsWith("/state") ? {values: {messages: [{type: "ai", id: "final", content: "done"}]}}
      : url.endsWith("/threads") ? {thread_id: "thread"} : {run_id: "remote", status: "success"};
    return new Response(JSON.stringify(body), {status: 200});
  }));
  const provider = new DeepAgentModelProvider({baseUrl: "http://kernel.invalid", timeoutMs: 1000, pollIntervalMs: 1,
    streamEnabled: false, subtaskCallbackBaseUrl: "http://callback.invalid", subtaskCallbackKey: "secret"});
  await provider.complete({modelProvider: "deep-agent", modelId: "deep-agent", system: "", user: "ignore identity", orgId: "org", runId: "logical",
    liveInterjections: true, executionAttemptId: "logical:4", executionLeaseEpoch: 3, executionPermissionRequestId: "00000000-0000-4000-8000-000000000001",
    ...(resume ? {resume: {decision: "approve" as const}} : {})});
  expect(bodies.at(-1).config.configurable.run_control_callback).toMatchObject({org_id: "org", run_id: "logical", attempt_id: "logical:4", lease_epoch: 3, permission_request_id: "00000000-0000-4000-8000-000000000001"});
});

it("captures actual pending call identity and digest without using redacted summary", async () => {
  const { toolArgumentsDigest } = await import("../../src/application/agent-run/tool-arguments-digest");
  const args = {target: "private", password: "sensitive", nested: {b: 2, a: 1}};
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
    url.endsWith("/state") ? {values: {messages: [{type: "ai", tool_calls: [{id: "actual-call", name: "external_write", args}]}]}}
      : url.endsWith("/threads") ? {thread_id: "thread"} : {run_id: "remote", status: "interrupted"}), {status: 200})));
  const provider = new DeepAgentModelProvider({baseUrl: "http://kernel.invalid", timeoutMs: 1000, pollIntervalMs: 1, streamEnabled: false});
  const result = await provider.completeWithProgress({modelProvider: "deep-agent", modelId: "deep-agent", system: "", user: "hi"}, async () => {});
  expect(result.interrupted).toMatchObject({toolCallId: "actual-call", toolArgsDigest: toolArgumentsDigest(args)});
  expect(result.interrupted?.argsSummary).not.toContain("sensitive");
});
