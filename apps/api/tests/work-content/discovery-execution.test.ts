import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoveryExecutionDefinition } from "../../src/domain/work-content/discovery-execution-definition";
import { discoveryExecutionGraph, type DiscoveryExecutionDeps } from "../../src/infrastructure/workflow/discovery-execution-graph";
import { defaultWorkflowGraphs } from "../../src/infrastructure/workflow/create-workflow-runtime";
import type { StageExecution } from "../../src/application/workflow/run-instance";
import type { WorkflowInstanceRepository } from "../../src/application/workflow/workflow-ports";
import type { WorkflowStageOutputStore } from "../../src/application/workflow/workflow-runtime-ports";
import { publishDiscovery } from "../../src/application/work-content/discovery-publication";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import type { ArtifactRepository } from "../../src/application/artifact/ports";
import { computeContentHash, versionContentHash } from "../../src/domain/artifact/content-hash";
import { discoveryCriteriaDigest, freezeDiscoveryPlan, validateDiscoveryStage } from "../../src/domain/work-content/discovery-stage-validation";
import { buildDiscoveryExecutionPack } from "../../scripts/build-discovery-execution-pack";
import { loadPinnedMethodFiles } from "../../src/infrastructure/work-content/pinned-method-files";
import { ModelContentSkillRunner } from "../../src/application/work-content/content-skill-runner";
import type { ModelCallPort } from "../../src/application/agent-run/ports";
import { getContentInstanceOutput } from "../../src/application/work-content/get-content-instance-output";
import { prepareDiscoveryOutline } from "../../src/application/work-content/discovery-outline-import";
import type { WorkflowInstanceProjection } from "@repo/contracts/workflow-runtime";

const tests = [{ testId: "T1", assumptionId: "A1", targetRung: "reported-behavior",
  pass: { metric: "accounts", op: ">=", numerator: 3, denominator: 5 },
  fail: { metric: "accounts", op: "<=", numerator: 1, denominator: 5 },
  minSample: { unit: "accounts", n: 5 }, evidenceOwner: "S009" }];
const plan = { planId: "plan-1", planVersion: 1, criteriaDigest: discoveryCriteriaDigest(tests),
  outcome: { status: "anchored", actor: "管理员", behavior: "首次邀请" },
  assumptions: [{ assumptionId: "A1", text: "管理员需要先找到可信邀请对象", selected: true }], tests };

describe("S062 outline import consumed boundary", () => {
  const outline = () => ({ planId: "ip-1", status: "ready-for-review",
    researchQuestions: [{ questionId: "RQ1", text: "首次邀请如何发生" }],
    guide: [{ sectionId: "core", section: "core", objective: "了解最近一次实际选择", minutes: 20, order: 1,
      items: [{ itemId: "Q1", kind: "question", text: "回忆最近一次邀请", rqIds: ["RQ1"] },
        { itemId: "Q2", kind: "question", text: "当时如何选择对象", rqIds: ["RQ1"] },
        { itemId: "P1", kind: "probe", text: "后来发生什么", rqIds: ["RQ1"], parentItemId: "Q1" },
        { itemId: "S1", kind: "script", text: "提醒可以跳过", rqIds: [] }] }] });
  it("maps authored questions without silently generating or padding content and gives each round a stable external key", () => {
    const imported = prepareDiscoveryOutline("instance-a", 1, outline(), 45);
    expect(imported.sections).toEqual([{ objective: "了解最近一次实际选择",
      openers: ["回忆最近一次邀请", "当时如何选择对象"], minutes: 20, order: 1 }]);
    expect(imported.externalRef).toBe(prepareDiscoveryOutline("instance-a", 1, outline(), 45).externalRef);
    expect(imported.externalRef).not.toBe(prepareDiscoveryOutline("instance-a", 2, outline(), 45).externalRef);
  });
  it("rejects incomplete guides, dangling RQs and orphan probes before any write can be attempted", () => {
    const incomplete = outline(); incomplete.guide[0]!.items.splice(1, 1);
    expect(() => prepareDiscoveryOutline("a", 1, incomplete, 45)).toThrow("discovery_outline_incomplete");
    const unknown = outline(); unknown.guide[0]!.items[0]!.rqIds = ["not-in-plan"];
    expect(() => prepareDiscoveryOutline("a", 1, unknown, 45)).toThrow("discovery_outline_unknown_rq");
    const orphan = outline(); orphan.guide[0]!.items[2]!.parentItemId = "missing";
    expect(() => prepareDiscoveryOutline("a", 1, orphan, 45)).toThrow("discovery_outline_orphan_probe");
  });
  it("rejects duplicate identifiers and an over-budget guide", () => {
    const duplicate = outline(); duplicate.guide.push(structuredClone(duplicate.guide[0]!));
    expect(() => prepareDiscoveryOutline("a", 1, duplicate, 45)).toThrow("discovery_outline_duplicate_section");
    expect(() => prepareDiscoveryOutline("a", 1, outline(), 15)).toThrow("discovery_outline_time_budget_exceeded");
  });
});

function fixture() {
  const definition = discoveryExecutionDefinition();
  const rows = new Map<string, Record<string, unknown>>();
  const instance = { orgId: "org-a", instanceId: "instance", workflowKey: definition.key,
    definitionVersion: definition.version, graphRef: definition.graphRef,
    initiatorUserId: "owner", agentId: "agent", agentVersionId: "frozen-agent" };
  const skills = { run: vi.fn(async (call: { stageId: string }) => call.stageId === "plan_interviews"
    ? { planId: "interview-plan", status: "ready-for-review", researchQuestions: [{ questionId: "RQ1", text: "回忆一次邀请对象的选择" }] }
    : plan) };
  const instances = { find: vi.fn(async (orgId: string) => orgId === instance.orgId ? instance : null) };
  const outputs = { find: vi.fn(async (orgId: string, _instance: string, stageId: string) =>
    orgId === instance.orgId && rows.has(stageId) ? { content: { output: rows.get(stageId) } } : null) };
  const effects = { execute: vi.fn(async () => { throw new Error("unexpected effect"); }) };
  const deps = { skills, instances: instances as unknown as WorkflowInstanceRepository,
    outputs: outputs as unknown as WorkflowStageOutputStore,
    effects: () => effects } as unknown as DiscoveryExecutionDeps;
  const graph = discoveryExecutionGraph(deps);
  const execution = (stageId: string): StageExecution => ({ instanceId: instance.instanceId, stageId, attempt: 1,
    lease: { orgId: instance.orgId } as StageExecution["lease"],
    input: { intent: "让中小团队管理员能够在首周找到可信赖的邀请对象", decision: "是否继续投入管理员邀请流程的探索" }, approval: null,
    pinnedSkills: definition.stages.find(stage => stage.stageId === stageId)!.skills.map(ref =>
      ({ stageId, stableId: ref.stableId, version: ref.versionRange })) });
  const stage = (stageId: string, exec = execution(stageId)) => graph.stages.find(s => s.stageId === stageId)!.work(exec);
  return { definition, graph, rows, skills, instances, outputs, effects, deps, execution, stage };
}

describe("W027 substantive execution boundaries", () => {
  it("fails closed for the historical metadata graph and for unconfigured v2", async () => {
    const f = fixture();
    const old = defaultWorkflowGraphs().find(g => g.graphRef === "discovery-to-opportunity:1")!;
    await expect(old.stages[0]!.work(f.execution("hypothesize"))).rejects.toMatchObject({
      reason: "W027_legacy_graph_has_no_content_executor" });
    await expect(discoveryExecutionGraph().stages[0]!.work(f.execution("hypothesize")))
      .rejects.toMatchObject({ reason: "W027_execution_not_configured" });
  });
  it("runs the exact pinned Skill against the user task and frozen Agent model identity", async () => {
    const f = fixture(); const result = await f.stage("hypothesize");
    expect(result.content.output).toMatchObject({ assumptions: [{ text: "管理员需要先找到可信邀请对象" }] });
    expect(f.skills.run).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-a",
      agentVersionId: "frozen-agent", skillId: "S061", skillVersion: "1.2.0", input: f.execution("hypothesize").input }));
  });
  it("opens review after generation and binds approval to its committed payload", async () => {
    const f = fixture();
    expect(f.definition.stages[0]!.humanGate).toBeNull();
    f.rows.set("hypothesize", (await f.stage("hypothesize")).content.output as Record<string, unknown>);
    const preview = await f.graph.stages.find(s => s.stageId === "review_hypothesize")!.gatePreview!(f.execution("review_hypothesize"));
    expect(preview.payloadPreview.output).toEqual(f.rows.get("hypothesize"));
    await expect(f.stage("review_hypothesize")).rejects.toMatchObject({ reason: "reviewed_output_or_approval_missing" });
    const exec = f.execution("review_hypothesize"); exec.approval = { gateId: "review-plan", decidedBy: "owner" };
    const review = await f.stage("review_hypothesize", exec);
    expect(review.content.output).toMatchObject({ approval: exec.approval,
      payloadDigest: preview.payloadPreview.payloadDigest });
    expect(f.effects.execute).not.toHaveBeenCalled();
  });
  it("resumes from durable prior output and rejects another tenant", async () => {
    const f = fixture(); f.rows.set("hypothesize", { planId: "persisted-plan" });
    f.rows.set("review_hypothesize", { approval: { decidedBy: "owner" } });
    await f.stage("plan_interviews");
    expect(f.skills.run).toHaveBeenCalledWith(expect.objectContaining({ prior: {
      hypothesize: { planId: "persisted-plan" }, review_hypothesize: { approval: { decidedBy: "owner" } } } }));
    const foreign = f.execution("hypothesize"); foreign.lease.orgId = "org-b";
    await expect(f.stage("hypothesize", foreign)).rejects.toMatchObject({ reason: "instance_missing_or_wrong_workflow" });
  });
  it("rejects missing/duplicate pins, stale predecessors and empty or metadata-only Skill replies", async () => {
    const f = fixture(); const exec = f.execution("hypothesize"); exec.pinnedSkills = [];
    await expect(f.stage("hypothesize", exec)).rejects.toMatchObject({ reason: "pinned_skill_missing_or_duplicated" });
    exec.pinnedSkills = [...f.execution("hypothesize").pinnedSkills, ...f.execution("hypothesize").pinnedSkills];
    await expect(f.stage("hypothesize", exec)).rejects.toMatchObject({ reason: "pinned_skill_missing_or_duplicated" });
    await expect(f.stage("plan_interviews")).rejects.toMatchObject({ reason: "prior_output_missing:hypothesize" });
    f.skills.run.mockResolvedValueOnce({ workflowId: "W027", stageId: "hypothesize" } as never);
    await expect(f.stage("hypothesize")).rejects.toMatchObject({ reason: "skill_output_empty:S061" });
  });
  it("does not simulate outline import when its platform adapter is absent", async () => {
    const f = fixture();
    for (const stage of f.definition.stages) {
      if (stage.stageId === "import_outline") break;
      f.rows.set(stage.stageId, { professionalOutput: "persisted" });
    }
    await expect(f.stage("import_outline")).rejects.toMatchObject({ reason: "stage_adapter_missing:import_outline" });
    expect(f.effects.execute).not.toHaveBeenCalled();
  });
  it("rejects metadata-only interview plans before invoking a configured write adapter or recording effects", async () => {
    const f = fixture(); const adapter = vi.fn(async () => ({ outlineId: "outline", status: "pending_confirm" }));
    f.deps.adapters = { import_outline: adapter };
    for (const stage of f.definition.stages) {
      if (stage.stageId === "import_outline") break;
      f.rows.set(stage.stageId, { professionalOutput: "persisted" });
    }
    await expect(f.stage("import_outline")).rejects.toThrow();
    expect(adapter).not.toHaveBeenCalled();
    expect(f.effects.execute).not.toHaveBeenCalled();
  });
  it("rejects professionally invalid JSON and changed preregistered criteria", async () => {
    const f = fixture();
    f.skills.run.mockResolvedValueOnce({ taskResult: "some nonempty prose that cannot satisfy a discovery plan" } as never);
    await expect(f.stage("hypothesize")).rejects.toMatchObject({ reason: "stage_schema_invalid:hypothesize" });
    expect(() => validateDiscoveryStage("hypothesize", { ...plan, criteriaDigest: "0".repeat(64) }, {}))
      .toThrow("criteria_digest_invalid");
    expect(discoveryCriteriaDigest(tests.map(test => ({ ...test, pass: { ...test.pass, label: "new display label" } }))))
      .toBe(plan.criteriaDigest);
    const { criteriaDigest: _modelDigest, ...modelPlan } = plan;
    expect(freezeDiscoveryPlan(modelPlan)).toMatchObject({ criteriaDigest: plan.criteriaDigest });
  });
  it("executes the packaged pinned authored method through the real content runner (deterministic model port)", async () => {
    const pack = buildDiscoveryExecutionPack();
    const f = fixture();
    const complete = vi.fn(async (request: { system: string; user: string }) => {
      expect(request.system).toContain("P6 登记冻结");
      expect(request.system).toContain("criteriaDigest = sha256");
      expect(JSON.parse(request.user).input.intent).toBe(f.execution("hypothesize").input.intent);
      return { text: JSON.stringify(plan) };
    });
    const runner = new ModelContentSkillRunner({ complete } as unknown as ModelCallPort,
      { agentVersionModel: async () => ({ modelProvider: "test-port", modelId: "frozen-model" }) }, {
        skillInstructions: async (org, id, version) => {
          const skill = pack.skills.find(s => org === "org-a" && s.name === id && s.semanticVersion === version);
          if (!skill) return null;
          const files = new Map(skill.files.map(file => [file.path, Buffer.from(file.contentBase64, "base64").toString()]));
          return loadPinnedMethodFiles(files.get("SKILL.md")!, `${id}@${version}`, async path => files.get(path) ?? null);
        },
      });
    const graph = discoveryExecutionGraph({ ...f.deps, skills: runner });
    const result = await graph.stages[0]!.work(f.execution("hypothesize"));
    expect(result.content.output).toMatchObject(plan);
    const foreign = f.execution("hypothesize"); foreign.lease.orgId = "org-b";
    await expect(graph.stages[0]!.work(foreign)).rejects.toMatchObject({ reason: "instance_missing_or_wrong_workflow" });
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("materializes and reopens actual exploratory files; readback failure does not record a version", async () => {
    const root = await mkdtemp(join(tmpdir(), "w027-publication-"));
    try {
      let sequence = 0; const repo = { createArtifact: vi.fn(async () => {}),
        headVersionNumber: async () => 0, createVersion: vi.fn(async () => {}) };
      const args = { orgId: "org-a", instanceId: "instance", initiatorUserId: "owner",
        input: { intent: "管理员邀请流程探索" }, prior: { frame: { frameId: "frame-1", version: 1,
          status: "draft", statement: "管理员无法判断适合邀请谁，导致首次协作延迟。" },
          map: { mapId: "map-1", version: 1, root: { frameId: "frame-1", frameVersion: 1 },
            evidenceBasis: { anyProvisional: true, synthesisIds: ["synthesis-1"] },
            opportunities: [{ oppId: "O1", statement: "管理员需要明确首次邀请对象" }],
            decision: { status: "proposed", proposedTarget: "O1" } } } };
      const result = await publishDiscovery({ store: new FsObjectStore(root), repo: repo as unknown as ArtifactRepository,
        ids: { next: p => `${p}-${++sequence}` } }, args);
      const reopened = await Promise.all((result.materializedKeys as string[]).map(key => new FsObjectStore(root).get(key)));
      expect(Buffer.from(reopened[0]!).toString()).toContain("管理员需要明确首次邀请对象");
      expect(JSON.parse(Buffer.from(reopened[1]!).toString())).toMatchObject({
        workflowId: "W027", instanceId: "instance", evidenceGrade: "exploratory-provisional", semanticSupportVerified: false });
      expect(result.contentHash).toBe(versionContentHash(reopened.map(bytes => computeContentHash(bytes!))));
      const read = vi.fn(async () => ({ content: { output: result } }));
      const get = vi.fn(async () => ({ workflowKey: "discovery-to-opportunity", definitionVersion: 2, status: "succeeded" } as WorkflowInstanceProjection));
      const output = await getContentInstanceOutput({ runtime: { get }, outputs: { find: read } as unknown as WorkflowStageOutputStore },
        "org-a", "owner", "instance");
      expect(output.output).toMatchObject({ kind: "discovery_artifact", map: { mapId: "map-1" } });
      expect(read).toHaveBeenCalledWith("org-a", "instance", "publish", 1);
      get.mockResolvedValueOnce({ workflowKey: "discovery-to-opportunity", definitionVersion: 2, status: "rejected" } as WorkflowInstanceProjection);
      read.mockClear();
      expect((await getContentInstanceOutput({ runtime: { get }, outputs: { find: read } as unknown as WorkflowStageOutputStore },
        "org-a", "owner", "instance")).output).toBeNull();
      expect(read).not.toHaveBeenCalled();
      repo.createVersion.mockClear();
      await expect(publishDiscovery({ store: { putOnce: async () => {}, get: async () => null, head: async () => null },
        repo: repo as unknown as ArtifactRepository, ids: { next: p => p } }, args)).rejects.toThrow("not readable");
      expect(repo.createVersion).not.toHaveBeenCalled();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
