/**
 * E9 —— 阶段工作失败：未到 maxAttempts 记 stage_retried 并冒泡（lease 保留待接管）；到上限或
 * 不可重试（MODEL_PROVIDER_NOT_CONFIGURED）→ stage_failed + 实例终态 failed（stage_attempts_exhausted）。
 * 纯内存端口：只验证 runInstance 的状态迁移与 projection。
 */
import { describe, expect, it } from "vitest";
import { buildProjection } from "../../src/application/workflow/instance-projection";
import { runInstance, type RunInstanceDeps } from "../../src/application/workflow/run-instance";
import type { PinnedWorkflowInstance, WorkflowLease } from "../../src/application/workflow/workflow-ports";
import type { WorkflowEventInput, WorkflowStoredEvent } from "../../src/application/workflow/workflow-runtime-ports";

class CodedError extends Error {
  constructor(readonly code: string) {
    super("boom");
  }
}

function setup(maxAttempts: number, fail: () => Error) {
  const events: WorkflowStoredEvent[] = [];
  const inst: PinnedWorkflowInstance & { reasonCode: string | null } = {
    instanceId: "i1", orgId: "o1", workflowKey: "k", definitionVersion: 1, graphRef: "g", pinnedSkills: [],
    agentId: "a", agentVersionId: "av", initiatorUserId: "u1", triggerKind: "manual", status: "running", stateVersion: 1, reasonCode: null,
  };
  const push = (e: WorkflowEventInput) => events.push({ ...e, seq: events.length + 1, stateVersion: inst.stateVersion, createdAt: "2026-09-29T00:00:00Z" });
  push({ type: "instance_started", stageId: null, reasonCode: null, data: { input: {} } });
  const definition = {
    key: "k", version: 1, graphRef: "g", title: "t", inputSchema: {}, status: "published",
    stages: [{ stageId: "frame", title: "界定问题", skills: [], capabilityCategories: [], sideEffect: "none", humanGate: null, maxAttempts }],
  } as never;
  let released = 0;
  const deps: RunInstanceDeps = {
    definitions: { findVersion: async () => definition } as never,
    instances: { find: async () => ({ ...inst }), create: async () => {} },
    events: {
      append: async (_o, _i, e, opts) => {
        if (opts?.status) { inst.status = opts.status; inst.reasonCode = opts.reasonCode ?? null; }
        inst.stateVersion++;
        push(e);
        return { ok: true, seq: events.length, stateVersion: inst.stateVersion, status: inst.status };
      },
      listAfter: async () => [...events],
      hasStageEvent: async (_o, _i, type, stageId, attempt) => events.some((e) => e.type === type && e.stageId === stageId && e.data.attempt === attempt),
      loadSnapshot: async () => null,
    },
    outputs: { find: async () => null, put: async (_o, _i, row) => ({ row, created: true }) },
    leases: { acquire: async () => lease, assertLease: async () => {}, renew: async () => {}, release: async () => { released++; } },
    driver: {
      run: async ({ stage }) => {
        await stage("frame", async () => { throw fail(); });
        return "completed";
      },
    },
    newId: () => "x",
  };
  const lease: WorkflowLease = { orgId: "o1", instanceId: "i1", holder: "w", epoch: 1 } as WorkflowLease;
  const projection = () =>
    buildProjection({ instance: { ...inst, createdAt: "", updatedAt: "" } as never, events, outputs: [] }, definition, { userId: "u1", orgRole: "member" });
  return { deps, lease, events, inst, projection, released: () => released };
}

describe("E9 stage attempts exhausted", () => {
  it("retries up to maxAttempts, then marks the stage and instance failed", async () => {
    const s = setup(3, () => new Error("transient"));
    await expect(runInstance(s.deps, s.lease)).rejects.toThrow("transient");
    expect(s.inst.status).toBe("running");
    expect(s.projection().stages[0]).toMatchObject({ status: "running", attempt: 2 });
    await expect(runInstance(s.deps, s.lease)).rejects.toThrow("transient");
    expect(s.released()).toBe(0);
    await expect(runInstance(s.deps, s.lease)).resolves.toBe("failed");
    expect(s.released()).toBe(1);
    const p = s.projection();
    expect(p).toMatchObject({ status: "failed", reasonCode: "stage_attempts_exhausted" });
    expect(p.stages[0]).toMatchObject({ status: "failed", attempt: 3, reasonCode: "stage_attempts_exhausted" });
    expect(s.events.filter((e) => e.type === "stage_retried")).toHaveLength(2);
  });

  it("fails immediately on a non-retryable provider-not-configured error", async () => {
    const s = setup(3, () => new CodedError("MODEL_PROVIDER_NOT_CONFIGURED"));
    await expect(runInstance(s.deps, s.lease)).resolves.toBe("failed");
    const failed = s.events.find((e) => e.type === "stage_failed");
    expect(failed?.data).toMatchObject({ attempt: 1, failureKind: "provider_not_configured" });
    expect(s.projection().status).toBe("failed");
  });
});
