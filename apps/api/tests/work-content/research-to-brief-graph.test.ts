import { describe, expect, it, vi } from "vitest";
import { researchToBriefGraph } from "../../src/infrastructure/workflow/research-to-brief-graph";
import { W001 } from "../../src/domain/work-content/definitions/W001";
import type { StageExecution } from "../../src/application/workflow/run-instance";
import type { PinnedWorkflowInstance } from "../../src/application/workflow/workflow-ports";
import type { WorkflowStageOutputRow } from "../../src/application/workflow/workflow-runtime-ports";
import { runInstance, type RunInstanceDeps } from "../../src/application/workflow/run-instance";
import { toResearchRuntimeDefinition } from "../../src/domain/work-content/workflow-definition";
import type { WorkflowStoredEvent, WorkflowEventInput } from "../../src/application/workflow/workflow-runtime-ports";

function fixture(orgId = "org-a", instanceId = "instance-a") {
  const rows = new Map<string, WorkflowStageOutputRow>();
  const instance: PinnedWorkflowInstance = {
    orgId, instanceId, workflowKey: W001.key, definitionVersion: 1, graphRef: "research-to-brief:1",
    pinnedSkills: [], agentId: "agent", agentVersionId: "frozen-agent-version", initiatorUserId: "initiator",
    triggerKind: "manual", status: "running", stateVersion: 1,
  };
  const outputs = {
    find: vi.fn(async (org: string, id: string, stage: string, attempt: number) =>
      rows.get(`${org}/${id}/${stage}/${attempt}`) ?? null),
    put: vi.fn(async () => { throw new Error("stage body must not write outputs"); }),
  };
  const calls: string[] = [];
  const skills = { run: vi.fn(async (call: { stageId: string }) => {
    calls.push(call.stageId);
    if (call.stageId === "search") return { materials: [{ ref: "source-1", text: "真实材料" }] };
    if (call.stageId === "risk") return { risks: [{ text: "不支持的风险", evidenceRefs: ["invented"] }] };
    if (call.stageId === "draft") return { title: "研究简报" };
    return { claims: [
      { text: "有证据的结论", evidenceRefs: ["source-1"], confidence: "high" },
      { text: "虚构引用", evidenceRefs: ["invented"] },
    ] };
  }) };
  const graph = researchToBriefGraph({ skills, outputs,
    instances: { find: vi.fn(async (org, id) => org === orgId && id === instanceId ? instance : null),
      create: vi.fn() } });
  function execution(stageId: string): StageExecution {
    return { instanceId, stageId, attempt: 1, input: { question: "仅基于材料分析", recipientCategories: ["internal"] },
      pinnedSkills: W001.stages.flatMap((stage) => stage.skills.map((stableId) =>
        ({ stageId: stage.stageId, stableId, version: "frozen-1.2.3" }))),
      lease: { orgId, instanceId, holder: "holder", epoch: 1 }, approval: null };
  }
  async function stage(stageId: string, exec = execution(stageId)) {
    const result = await graph.stages.find((item) => item.stageId === stageId)!.work(exec);
    rows.set(`${orgId}/${instanceId}/${stageId}/1`, {
      stageId, attempt: 1, outputId: `out-${stageId}`, label: result.label, content: result.content,
    });
    return result;
  }
  return { graph, outputs, skills, calls, rows, execution, stage, instance };
}

function runtimeFixture() {
  const f = fixture();
  f.instance.pinnedSkills = f.execution("scope").pinnedSkills;
  const events: WorkflowStoredEvent[] = [];
  const append = async (_org: string, _id: string, event: WorkflowEventInput,
    opts?: { status?: PinnedWorkflowInstance["status"] }) => {
    if (opts?.status) f.instance.status = opts.status;
    f.instance.stateVersion++;
    events.push({ ...event, seq: events.length + 1, stateVersion: f.instance.stateVersion, createdAt: "2026-10-03T00:00:00Z" });
    return { ok: true, seq: events.length, stateVersion: f.instance.stateVersion, status: f.instance.status };
  };
  const lease = f.execution("scope").lease;
  const deps = {
    definitions: { findVersion: async () => toResearchRuntimeDefinition(W001) },
    instances: { find: async () => f.instance },
    events: {
      append, listAfter: async () => events,
      hasStageEvent: async (_org: string, _id: string, type: string, stage: string, attempt: number) =>
        events.some((event) => event.type === type && event.stageId === stage && event.data.attempt === attempt),
    },
    outputs: { find: f.outputs.find, put: async (org: string, id: string, row: WorkflowStageOutputRow) => {
      const key = `${org}/${id}/${row.stageId}/${row.attempt}`;
      const existing = f.rows.get(key); if (existing) return { row: existing, created: false };
      f.rows.set(key, row); return { row, created: true };
    } },
    leases: { assertLease: vi.fn(async () => {}), release: vi.fn(async () => {}) },
    driver: { run: async ({ stage }: { stage: Parameters<RunInstanceDeps["driver"]["run"]>[0]["stage"] }) => {
      for (const node of f.graph.stages) await stage(node.stageId, node.work);
      return "completed";
    } },
    newId: () => `output-${events.length}`, hooks: {},
  } as unknown as RunInstanceDeps;
  async function start() {
    await append("org-a", "instance-a", { type: "instance_started", stageId: null, reasonCode: null,
      data: { input: f.execution("scope").input } });
  }
  async function approve(stageId: string) {
    await append("org-a", "instance-a", { type: "gate_decided", stageId, reasonCode: null,
      data: { gateId: `${stageId}-gate-1`, decision: "approved", decidedBy: "existing-test-approver" } }, { status: "running" });
  }
  return { ...f, deps, events, start, approve, run: () => runInstance(deps, lease) };
}

describe("W001 checkpointed professional stage bodies", () => {
  it("keeps the frozen definition's stage order and emits a complete evidenced draft", async () => {
    const f = fixture();
    expect(f.graph.stages.map((stage) => stage.stageId)).toEqual(W001.stages.map((stage) => stage.stageId));
    for (const stage of W001.stages.slice(0, 7)) await f.stage(stage.stageId);
    expect(f.calls).toEqual(["search", "synthesize", "audit", "risk", "draft"]);
    const draft = f.rows.get("org-a/instance-a/draft/1")!.content.output as { output: unknown };
    expect(draft.output).toMatchObject({ kind: "research_brief", title: "研究简报",
      claims: [{ text: "有证据的结论", evidenceRefs: ["source-1"] }], risks: [] });
    expect(f.skills.run.mock.calls[0]![0]).toMatchObject({ skillVersion: "frozen-1.2.3", agentVersionId: "frozen-agent-version" });
    expect(f.outputs.put).not.toHaveBeenCalled();
  });
  it("restores the next stage from durable prior outputs without rerunning earlier skills", async () => {
    const f = fixture();
    await f.stage("scope"); await f.stage("search"); await f.stage("synthesize");
    f.skills.run.mockClear();
    await f.stage("audit");
    expect(f.skills.run).toHaveBeenCalledTimes(1);
    expect(f.skills.run.mock.calls[0]![0]).toMatchObject({ stageId: "audit",
      prior: { search: { materials: [{ ref: "source-1" }] } } });
  });
  it("does not reuse another tenant's prior outputs or agent identity", async () => {
    const f = fixture(); await f.stage("scope");
    const exec = f.execution("search"); exec.lease.orgId = "org-b";
    await expect(f.stage("search", exec)).rejects.toMatchObject({ reason: "instance_missing_or_wrong_workflow" });
    expect(f.skills.run).not.toHaveBeenCalled();
  });
  it("fails before the model when frozen pins are missing or duplicated", async () => {
    const f = fixture(); await f.stage("scope");
    const exec = f.execution("search"); exec.pinnedSkills = [];
    await expect(f.stage("search", exec)).rejects.toMatchObject({ reason: "pinned_skill_missing_or_duplicated" });
    expect(f.skills.run).not.toHaveBeenCalled();
  });
  it("does not silently synthesize a missing prior stage", async () => {
    const f = fixture();
    await expect(f.stage("synthesize")).rejects.toMatchObject({ reason: "prior_output_missing:scope" });
    expect(f.skills.run).not.toHaveBeenCalled();
  });
  it("keeps a durable data-needs draft and blocks further progress when no evidence exists", async () => {
    const f = fixture();
    f.skills.run.mockImplementation(async () => ({ materials: [] }));
    for (const stage of W001.stages.slice(0, 6)) await f.stage(stage.stageId);
    expect(f.skills.run).toHaveBeenCalledTimes(1);
    expect(f.rows.get("org-a/instance-a/draft/1")!.content.output).toMatchObject({ output: { kind: "data_needs_statement" } });
    await expect(f.stage("citation_check")).rejects.toMatchObject({ reason: "evidence_missing_no_publication" });
  });
  it("fails closed at publication without fabricating artifact or distribution success", async () => {
    const f = fixture();
    await expect(f.stage("publish")).rejects.toMatchObject({ reason: "publication_contract_not_connected" });
    await expect(f.stage("distribute")).rejects.toMatchObject({ reason: "publication_contract_not_connected" });
    expect(f.skills.run).not.toHaveBeenCalled(); expect(f.outputs.put).not.toHaveBeenCalled();
  });
  it("lets the generic runtime stop at original scope and review gates, then blocks incomplete publication", async () => {
    const f = runtimeFixture(); await f.start();
    expect(await f.run()).toBe("awaiting_gate_decision");
    expect(f.skills.run).not.toHaveBeenCalled();
    await f.approve("scope");
    expect(await f.run()).toBe("awaiting_gate_decision");
    expect(f.events.filter((event) => event.type === "gate_opened").map((event) => event.stageId)).toEqual(["scope", "review_brief"]);
    expect(f.skills.run).toHaveBeenCalledTimes(5);
    await f.approve("review_brief");
    expect(await f.run()).toBe("failed");
    expect(f.skills.run).toHaveBeenCalledTimes(5);
    expect(f.rows.has("org-a/instance-a/publish/1")).toBe(false);
    expect(f.events.some((event) => event.type === "stage_succeeded" && event.stageId === "publish")).toBe(false);
  });
  it("uses runtime recovery after output-written failure without duplicate search or stage events", async () => {
    const f = runtimeFixture(); await f.start(); await f.run(); await f.approve("scope");
    f.deps.hooks!.afterStageOutput = vi.fn(async (stage) => { if (stage === "search") throw new Error("injected checkpoint-boundary failure"); });
    await expect(f.run()).rejects.toThrow("injected checkpoint-boundary failure");
    expect(f.rows.has("org-a/instance-a/search/1")).toBe(true);
    f.deps.hooks!.afterStageOutput = undefined;
    expect(await f.run()).toBe("awaiting_gate_decision");
    expect(f.skills.run.mock.calls.filter(([call]) => call.stageId === "search")).toHaveLength(1);
    expect(f.events.filter((event) => event.stageId === "search" && event.type === "stage_output_written")).toHaveLength(1);
  });
});
