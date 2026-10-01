import { describe, expect, it, vi } from "vitest";
import type { WorkflowDefinitionVersionView } from "@repo/contracts/workflow-runtime";
import { EffectGateway, type EffectGatewayDeps } from "../../src/application/workflow/effect-gateway";
import type { WorkflowLease } from "../../src/application/workflow/workflow-ports";
import { buildProjection, getInstanceProjection } from "../../src/application/workflow/instance-projection";
import type { WorkflowInstanceState, WorkflowStoredEvent } from "../../src/application/workflow/workflow-runtime-ports";

const instance: WorkflowInstanceState = {
  instanceId: "i1", orgId: "o1", workflowKey: "test", definitionVersion: 1, graphRef: "test:1", pinnedSkills: [],
  agentId: "agent", agentVersionId: "version", initiatorUserId: "owner", triggerKind: "manual", status: "running",
  stateVersion: 1, reasonCode: null, createdAt: "", updatedAt: "",
};
const definition = { key: "test", version: 1, graphRef: "test:1", title: "test", inputSchema: {}, status: "published", stages: [] } as unknown as WorkflowDefinitionVersionView;
const provenance = { initiatorUserId: "owner", agentId: "agent", agentVersionId: "version", approvalRequestId: "actual-gate" };
function event(seq: number, type: WorkflowStoredEvent["type"], data: Record<string, unknown> = {}, stageId = "persist", reasonCode: WorkflowStoredEvent["reasonCode"] = null): WorkflowStoredEvent {
  return { seq, stateVersion: seq, createdAt: "2026-10-01T00:00:00Z", type, stageId, reasonCode, data: { effectKey: "same-key", capabilityCategory: "artifact.write", ...data } };
}
function project(events: WorkflowStoredEvent[]) {
  return buildProjection({ instance, events, outputs: [] }, definition, { userId: "owner", orgRole: "member" });
}

describe("effect event projection", () => {
  it("keeps snapshot prefix at begun; finalized duplicates produce exactly one effect per stage/key", () => {
    const events = [event(1, "effect_begun", { provenance }), event(2, "effect_finalized", { provenance }), event(3, "effect_finalized", { provenance })];
    expect(project(events.slice(0, 1))).toMatchObject({ lastSeq: 1, effects: [{ status: "begun", gateId: "actual-gate" }] });
    const result = project([...events, event(4, "effect_begun"), event(5, "effect_finalized", {}, "notify")]);
    expect(result.lastSeq).toBe(5);
    expect(result.effects).toHaveLength(2);
    expect(result.effects[0]).toMatchObject({ status: "finalized", gateId: "actual-gate", skillVersion: null, finalizedAt: null });
    expect(result.effects[1]).toMatchObject({ stageId: "notify", status: "finalized", gateId: null });
  });
  it("does not guess a gate from earlier approval or skill from stage pins for legacy events", () => {
    const result = project([event(1, "gate_decided", { gateId: "unrelated", decision: "approved" }, "prd_gate"), event(2, "effect_finalized")]);
    expect(result.effects).toEqual([{ effectKey: "same-key", stageId: "persist", capabilityCategory: "artifact.write", status: "finalized", initiatorUserId: "owner", agentId: "agent", agentVersionId: "version", skillVersion: null, gateId: null, finalizedAt: null }]);
  });
  it("preserves original provenance through reconciliation and ignores permission blocks without effects", () => {
    expect(project([event(1, "effect_blocked", {}, "persist", "agent_permission_revoked")]).effects).toEqual([]);
    expect(project([event(1, "effect_blocked", {}, "persist", "effect_unreconciled")]).effects).toEqual([]);
    expect(project([event(1, "effect_begun", { provenance }), event(2, "effect_finalized", { reconciled: true })]).effects[0]).toMatchObject({ status: "reconciled", gateId: "actual-gate" });
    expect(project([event(1, "effect_begun", { provenance }), event(2, "effect_blocked", {}, "persist", "effect_unreconciled")]).effects[0]).toMatchObject({ status: "unresolved", gateId: "actual-gate" });
  });
  it("writes actual execution provenance into both events and exposes finalized effects", async () => {
    const events: WorkflowStoredEvent[] = [];
    const finalize = vi.fn(async () => ({}));
    const deps = {
      leases: { assertLease: async () => {} }, permission: { recheck: async () => ({ ok: true }) },
      instances: { find: async () => instance },
      receipts: { begin: async () => ({ kind: "begun" }), finalize },
      events: { append: async (_org: string, _id: string, input: Omit<WorkflowStoredEvent, "seq" | "stateVersion" | "createdAt">) => {
        events.push({ ...input, seq: events.length + 1, stateVersion: 1, createdAt: "2026-10-01T00:00:00Z" });
        return { ok: true, seq: events.length, stateVersion: 1, status: "running" };
      } },
    } as unknown as EffectGatewayDeps;
    await new EffectGateway(deps).execute({} as WorkflowLease, {
      orgId: "o1", instanceId: "i1", stageId: "persist", workflowKey: "test", effectKey: "same-key",
      capabilityCategory: "artifact.write", sideEffect: "write", initiatorUserId: "owner", agentId: "agent",
      agentVersionId: "version", approvalRequestId: "actual-gate", fingerprint: "hash", args: {},
    }, async () => ({ artifactId: "artifact" }));
    expect(events.map(e => e.data.provenance)).toEqual([provenance, provenance]);
    expect(finalize).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ stableResponse: { result: { artifactId: "artifact" }, provenance } }));
    expect(project(events).effects).toHaveLength(1);
    expect(project(events).effects[0]).toMatchObject({ status: "finalized", gateId: "actual-gate" });
  });
  it("keeps tenant lookup and visibility before exposing any effect", async () => {
    const loadSnapshot = vi.fn(async (orgId: string) => orgId === "o1" ? { instance, events: [event(1, "effect_finalized")], outputs: [] } : null);
    const deps = { access: { orgRoleOf: async () => "member" as const }, definitions: { findVersion: async () => definition }, events: { loadSnapshot } } as unknown as Parameters<typeof getInstanceProjection>[0];
    await expect(getInstanceProjection(deps, { orgId: "o2", userId: "owner", instanceId: "i1" })).rejects.toMatchObject({ code: "workflow_not_found" });
    await expect(getInstanceProjection(deps, { orgId: "o1", userId: "stranger", instanceId: "i1" })).rejects.toMatchObject({ code: "workflow_not_found" });
    expect(loadSnapshot).toHaveBeenCalledWith("o2", "i1");
    expect((await getInstanceProjection(deps, { orgId: "o1", userId: "owner", instanceId: "i1" })).effects).toHaveLength(1);
  });
});
