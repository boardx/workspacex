/** Real native adapter HTTP serialization; recording transport has zero supplier requests. */
import { afterEach, expect, it, vi } from "vitest";
import { computeContentHash } from "../../src/domain/artifact/content-hash";
import { DeepAgentModelProvider } from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import type { ModelCallInput } from "../../src/application/agent-run/ports";
import { startAidtRecordingNative } from "../support/aidt-recording-native";
let transport: Awaited<ReturnType<typeof startAidtRecordingNative>> | undefined;
afterEach(async () => { await transport?.close(); transport = undefined; });
const block = '[Untrusted student reference]\n{"stage":1,"revision":7}';
const hash = computeContentHash(Buffer.from(block));
function input(): ModelCallInput {
  return { modelProvider: "deep-agent", modelId: "offline-pinned", runId: "local-run", threadId: "local-thread", system: "Pinned instructions", user: "  人类原文\n ", history: [{ role: "user", content: block }], referenceDispatchObserver: { historyIndex: 0, contentSha256: hash, beforeDispatch: vi.fn(async () => {}), onDispatched: vi.fn(async () => {}) } };
}
async function setup() { transport = await startAidtRecordingNative(); return new DeepAgentModelProvider({ baseUrl: transport.baseUrl, timeoutMs: 2000, pollIntervalMs: 1 }); }
it("observes the exact reference in actual serialized native messages only after successful submission", async () => {
  const provider = await setup(), value = input();
  await provider.complete(value);
  expect(transport!.submissions).toHaveLength(1); expect(transport!.supplierRequests).toBe(0);
  expect(transport!.submissions[0]!.body).toMatchObject({ input: { messages: [{ role: "system", content: value.system }, { role: "user", content: block }, { role: "user", content: value.user }] } });
  expect(value.referenceDispatchObserver!.beforeDispatch).toHaveBeenCalledOnce();
  expect(value.referenceDispatchObserver!.onDispatched).toHaveBeenCalledWith({ kind: "message-dispatch-observed", contentSha256: hash, remoteRunId: transport!.submissions[0]!.runId, remoteThreadId: transport!.submissions[0]!.threadId });
});
it("rejects a tampered reference before any run submission or dispatch receipt", async () => {
  const provider = await setup(), source = input(), value: ModelCallInput = { ...source, history: [{ role: "user", content: "different reference" }] };
  await expect(provider.complete(value)).rejects.toMatchObject({ code: "MODEL_CALL_FAILED" });
  expect(transport!.submissions).toHaveLength(0); expect(value.referenceDispatchObserver!.onDispatched).not.toHaveBeenCalled();
});
it("rechecks current authorization at the transport boundary and sends no run after revocation", async () => {
  const provider = await setup(), source = input(), value: ModelCallInput = { ...source, referenceDispatchObserver: { ...source.referenceDispatchObserver!, beforeDispatch: vi.fn(async () => { throw new Error("revoked"); }) } };
  await expect(provider.complete(value)).rejects.toThrow("revoked"); expect(transport!.submissions).toHaveLength(0); expect(value.referenceDispatchObserver!.onDispatched).not.toHaveBeenCalled();
});
it("does not record dispatch or retry after native HTTP rejection", async () => {
  const provider = await setup(), value = input(); transport!.rejectRunWith(503);
  await expect(provider.complete(value)).rejects.toMatchObject({ code: "MODEL_CALL_FAILED" });
  expect(transport!.submissions).toHaveLength(1); expect(value.referenceDispatchObserver!.onDispatched).not.toHaveBeenCalled();
});
it("does not turn a post-submit journal failure into a second model request", async () => {
  const provider = await setup(), source = input(), value: ModelCallInput = { ...source, referenceDispatchObserver: { ...source.referenceDispatchObserver!, onDispatched: vi.fn(async () => { throw new Error("journal unavailable"); }) } };
  await expect(provider.complete(value)).resolves.toHaveProperty("text"); expect(transport!.submissions).toHaveLength(1);
});
it.each(["hitl", "checkpoint"])("%s continuation preserves the remote thread and sends only command, never replayed reference messages", async kind => {
  const provider = await setup(), value = input(); await provider.complete(value);
  const resumed: ModelCallInput = { ...value, ...(kind === "hitl" ? { resume: { decision: "approve" as const } } : { checkpointResume: true }) };
  await provider.complete(resumed);
  expect(transport!.submissions).toHaveLength(2); expect(transport!.submissions[1]!.threadId).toBe(transport!.submissions[0]!.threadId);
  expect(transport!.submissions[1]!.body).not.toHaveProperty("input"); expect(transport!.submissions[1]!.body).toHaveProperty("command");
  expect(value.referenceDispatchObserver!.onDispatched).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "checkpoint-resume-observed", contentSha256: hash }));
});
it("keeps ordinary native input free of reference metadata and observer side effects", async () => {
  const provider = await setup(), { referenceDispatchObserver: _observer, ...value } = input(); await provider.complete(value);
  expect(transport!.submissions).toHaveLength(1); expect(JSON.stringify(transport!.submissions[0]!.body)).not.toContain("referenceDispatchObserver");
  expect(transport!.supplierRequests).toBe(0);
});
