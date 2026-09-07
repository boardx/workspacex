import { afterEach, expect, it, vi } from "vitest";
import { DeepAgentModelProvider, deriveRemoteThreadId } from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import type { ModelCallInput } from "../../src/application/agent-run/ports";
const binding = { bindingId: "11111111-1111-4111-8111-111111111111", profile: "native-v1" as const, policy: "native-v1" as const };
const input: ModelCallInput = { modelProvider: "deep-agent", modelId: "test", system: "", user: "hi", orgId: "org", runId: "run",
  executionAttemptId: "run:1", executionLeaseEpoch: 1, nativeSession: binding, onSkillActivity: async () => {} };
function fixture() {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/stream")) return new Response("event: end\ndata: {}\n\n", { headers: { "content-type": "text/event-stream" } });
    if (url.endsWith("/runs") && init?.method === "POST") { bodies.push(JSON.parse(String(init.body))); return Response.json({ run_id: "remote" }); }
    if (url.endsWith("/state")) return Response.json({ values: { messages: [{ type: "ai", content: "done" }] } });
    if (url.endsWith("/runs/remote")) return Response.json({ status: "success" });
    return Response.json({ thread_id: init?.body ? JSON.parse(String(init.body)).thread_id ?? "thread" : "thread", status: "idle" });
  }));
  return { bodies, provider: new DeepAgentModelProvider({ baseUrl: "http://kernel.invalid", timeoutMs: 1000, pollIntervalMs: 1,
    subtaskCallbackBaseUrl: "http://gateway.invalid", subtaskCallbackKey: "service-key" }) };
}
afterEach(() => vi.unstubAllGlobals());
for (const continuation of [{}, { resume: { decision: "approve" as const } }, { checkpointResume: true }]) {
  it(`forwards the same non-secret native binding on ${JSON.stringify(continuation)}`, async () => {
    const { bodies, provider } = fixture();
    await provider.complete({ ...input, ...continuation });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ config: { configurable: { native_runtime: binding,
      run_control_callback: { org_id: "org", run_id: "run", attempt_id: "run:1", lease_epoch: 1 } } } });
    expect(JSON.stringify(bodies[0])).not.toContain('"token"');
  });
}
for (const invalid of [
  { nativeSession: { ...binding, token: "secret" } }, { executionMode: "text-only" }, { scriptProtocol: "legacy" },
  { executionAttemptId: undefined }, { executionLeaseEpoch: undefined }, { onSkillActivity: undefined },
]) it(`refuses incompatible native configuration ${Object.keys(invalid)}`, async () => {
  const { bodies, provider } = fixture();
  await expect(provider.complete({ ...input, ...invalid } as ModelCallInput)).rejects.toMatchObject({ code: "MODEL_CALL_FAILED", detail: "native_runtime_configuration_invalid" });
  expect(bodies).toHaveLength(0);
});

it("isolates native checkpoints by binding and reports the actual remote thread for recovery", async () => {
  const { provider } = fixture();
  const started = vi.fn(async () => {});
  await provider.complete({ ...input, threadId: "legacy-chat", onRemoteRunStarted: started });
  const nativeId = deriveRemoteThreadId(`native:${binding.bindingId}`);
  expect(started).toHaveBeenCalledWith("remote", nativeId);
  expect(nativeId).not.toBe(deriveRemoteThreadId("legacy-chat"));
  await provider.complete({ ...input, nativeSession: { ...binding, bindingId: "22222222-2222-4222-8222-222222222222" }, onRemoteRunStarted: started });
  expect(started.mock.calls[1]).not.toEqual(started.mock.calls[0]);
});
