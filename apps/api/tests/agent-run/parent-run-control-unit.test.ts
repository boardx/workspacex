import { expect, it, vi } from "vitest";
import { ParentRunControl, parentCancelRequestId } from "../../src/application/agent-run/parent-run-control";
import { ToolExecutionAuthority, type ToolAuthoritySnapshot } from "../../src/application/agent-run/tool-execution-authority";
import { createInMemoryToolPermissionGrantStore } from "../../src/application/agent-run/tool-permission-grants";
import { toOrgId } from "../../src/domain/org-id";
const orgId = toOrgId("org-test");
const input = { orgId, parentRunId: "run", attemptId: "run:1", leaseEpoch: 2, toolName: "read_file" };
const snapshot: ToolAuthoritySnapshot = { active: true, cancelRequested: false, leaseValid: true, attemptId: "run:1", skillVersionIds: [] };
function authority(patch: Partial<ToolAuthoritySnapshot> = {}) {
  const grants = createInMemoryToolPermissionGrantStore();
  const service = new ToolExecutionAuthority({ withSnapshot: async (_input, check) => check({ ...snapshot, ...patch }) },
    { readPinnedSkills: async () => [] }, grants);
  return { service, grants };
}
it("allows existing L0 path but lease alone never approves an unknown tool", async () => {
  const { service, grants } = authority();
  expect(await service.check(input)).toEqual({ allowed: true });
  expect(await service.check({ ...input, toolName: "external_write" })).toEqual({ allowed: false, reason: "approval_required" });
  await grants.grantForRun(orgId, "run", "external_write");
  expect(await service.check({ ...input, toolName: "external_write" })).toEqual({ allowed: true });
});
it.each([
  [{ active: false }, "run_unavailable"], [{ cancelRequested: true }, "cancel_requested"],
  [{ leaseValid: false }, "lease_lost"], [{ attemptId: "run:4" }, "attempt_stale"],
] as const)("rejects unsafe runtime snapshot %j", async (patch, reason) => {
  expect(await authority(patch).service.check(input)).toEqual({ allowed: false, reason });
});
it("cannot grant an unmounted skill even with standing approval", async () => {
  const { service, grants } = authority();
  await grants.grantStanding(orgId, "call_skill", "user");
  expect(await service.check({ ...input, toolName: "call_skill", skillStableName: "unmounted" })).toEqual({ allowed: false, reason: "skill_not_mounted" });
});
it("derives stable tenant scoped cancellation identity and retains pending children", async () => {
  const requestId = parentCancelRequestId(orgId, "run", "2026-09-07T00:00:00Z");
  expect(requestId).toBe(parentCancelRequestId(orgId, "run", new Date("2026-09-07T00:00:00Z")));
  expect(requestId).not.toBe(parentCancelRequestId(toOrgId("other"), "run", "2026-09-07T00:00:00Z"));
  const reader = { readCancellation: async () => ({ orgId, parentRunId: "run", requestId }) };
  expect(await new ParentRunControl(reader).propagateCancellation(orgId, "run")).toEqual({ kind: "unavailable" });
  const cancelChildren = vi.fn(async () => ({ kind: "pending" as const, runningChildIds: ["child"] }));
  const control = new ParentRunControl(reader, { cancelChildren, readCancellation: cancelChildren });
  expect(await control.propagateCancellation(orgId, "run")).toEqual({ kind: "pending", runningChildIds: ["child"] });
  await control.propagateCancellation(orgId, "run");
  expect(cancelChildren.mock.calls[0]).toEqual(cancelChildren.mock.calls[1]);
});

it("does not turn a persisted parent cancellation into an error when child adapter fails", async () => {
  const control = new ParentRunControl({ readCancellation: async () => ({orgId, parentRunId: "run", requestId: "stable"}) }, {
    cancelChildren: async () => { throw new Error("offline"); }, readCancellation: async () => { throw new Error("offline"); },
  });
  expect(await control.propagateCancellation(orgId, "run")).toEqual({kind: "unavailable"});
  expect(await control.readCancellation(orgId, "run")).toEqual({kind: "unavailable"});
  expect(await new ParentRunControl({readCancellation: async () => null}).readCancellation(orgId, "run")).toEqual({kind: "not_requested"});
});
it("uses exact once authorization only after run, lease and attempt guards", async () => {
  const authorizeOnce = vi.fn().mockResolvedValue(true);
  const service = authority({authorizeOnce}).service;
  expect(await service.check({...input, toolName: "external_write"})).toEqual({allowed: true});
  expect(authorizeOnce).toHaveBeenCalledTimes(1);
  expect(await authority({authorizeOnce, attemptId: "other"}).service.check({...input, toolName: "external_write"})).toEqual({allowed: false, reason: "attempt_stale"});
  expect(authorizeOnce).toHaveBeenCalledTimes(1);
});

it("classifies call_skill by actual args and cannot smuggle an L2 target behind an L0 hint", async () => {
  const service = new ToolExecutionAuthority({withSnapshot: async (_input, check) => check(snapshot)}, {
    readPinnedSkills: async () => [
      {versionId: "low", stableName: "low", name: "Low", content: "---\nrisk_level: L0\n---"},
      {versionId: "high", stableName: "high", name: "High", content: "---\nrisk_level: L2\n---"},
    ],
  }, createInMemoryToolPermissionGrantStore());
  expect(await service.check({...input, toolName: "call_skill", skillStableName: "low", toolArgs: {skill_stable_name: "high"}})).toEqual({allowed: false, reason: "skill_not_mounted"});
  expect(await service.check({...input, toolName: "call_skill", toolArgs: {skill_stable_name: "high"}})).toEqual({allowed: false, reason: "approval_required"});
  expect(await service.check({...input, toolName: "call_skill", toolArgs: {skill_stable_name: "low"}})).toEqual({allowed: true});
});
