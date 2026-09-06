import { expect, it, vi } from "vitest";
import { invokeKernel } from "../../src/application/agent-run/invoke-kernel";
import type { ModelCallInput, ModelCallCompletion } from "../../src/application/agent-run/ports";
import type { NativeSessionOwner } from "../../src/application/agent-run/native-session-owner";
const binding = { bindingId: "11111111-1111-4111-8111-111111111111", profile: "native-v1" as const, policy: "native-v1" as const };
const input: ModelCallInput = { modelProvider: "deep-agent", modelId: "test", system: "", user: "hi", orgId: "org", runId: "run",
  executionAttemptId: "run:1", executionLeaseEpoch: 1, onSkillActivity: async () => {}, onRemoteRunStarted: async () => {} };
function fixture(completion: ModelCallCompletion = { text: "done" }) {
  const owner = { provision: vi.fn(async () => binding), release: vi.fn(async () => {}), releaseForRun: vi.fn(async () => {}), resolve: vi.fn() } as NativeSessionOwner & { provision: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  const model = { complete: vi.fn(async () => completion) };
  const log = vi.fn();
  const run = (value = input) => invokeKernel(model, value, async () => {}, async () => {}, { owner, logReleaseFailure: log });
  return { owner, model, log, run };
}
it("binds the trusted attempt once and releases after terminal completion without any script replay", async () => {
  const f = fixture(); expect(await f.run()).toEqual({ text: "done" });
  expect(f.owner.provision).toHaveBeenCalledTimes(1);
  expect(f.owner.provision).toHaveBeenCalledWith({ orgId: "org", parentRunId: "run", attemptId: "run:1", leaseEpoch: 1 }, [], expect.objectContaining({ read_file: false, delete: true, execute: true, wx_artifact_publish: true }));
  expect(f.model.complete).toHaveBeenCalledWith(expect.objectContaining({ nativeSession: binding }));
  expect(f.model.complete).toHaveBeenCalledTimes(1);
  expect(f.owner.release).toHaveBeenCalledWith(binding.bindingId, "org", "run");
});
it("retains a paused session for the next attempt", async () => {
  const f = fixture({ text: "", paused: true }); await f.run(); expect(f.owner.release).not.toHaveBeenCalled();
});
it("releases on failure, but cleanup failure cannot replace the original failure or trigger model retries", async () => {
  const f = fixture(); f.model.complete.mockRejectedValue(new Error("original_failure")); f.owner.release.mockRejectedValue(new Error("cleanup_failed"));
  await expect(f.run()).rejects.toThrow("original_failure"); expect(f.log).toHaveBeenCalledTimes(1); expect(f.model.complete).toHaveBeenCalledTimes(1);
});
it("rejects a legacy body-only skill before any model or sandbox submission", async () => {
  const f = fixture(); await expect(f.run({ ...input, skills: [{ versionId: "v", stableName: "body-only", name: "Body only", content: "text" }] })).rejects.toMatchObject({ detail: "native_complete_package_required" });
  expect(f.owner.provision).not.toHaveBeenCalled(); expect(f.model.complete).not.toHaveBeenCalled();
});
it("requires remote identity persistence before creating native resources", async () => {
  const f = fixture(); await expect(f.run({ ...input, onRemoteRunStarted: undefined })).rejects.toMatchObject({ detail: "native_execution_context_unavailable" });
  expect(f.owner.provision).not.toHaveBeenCalled();
});
