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
    liveInterjections: true, executionAttemptId: "logical:4", executionLeaseEpoch: 3,
    ...(resume ? {resume: {decision: "approve" as const}} : {})});
  expect(bodies.at(-1).config.configurable.run_control_callback).toMatchObject({org_id: "org", run_id: "logical", attempt_id: "logical:4", lease_epoch: 3});
});
