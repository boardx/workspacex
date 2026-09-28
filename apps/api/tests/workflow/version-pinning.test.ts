/**
 * WF01：发布校验 + 实例版本固定（ADR-118 第 5 条；domain I-2/I-3/I-4/I-5）。
 * 端口用内存实现——本 feature 只交付 domain 规则、ports 与用例；PG 实现在 WF02。
 */
import { describe, expect, it } from "vitest";
import type { WorkflowDefinitionVersionView } from "@repo/contracts/workflow-runtime";
import { publishDefinitionVersion } from "../../src/application/workflow/publish-definition-version";
import { createPinnedInstance, loadPinnedExecutionPlan } from "../../src/application/workflow/pin-workflow-instance";
import { WorkflowUseCaseError } from "../../src/application/workflow/workflow-errors";
import type {
  PinnedWorkflowInstance,
  WorkflowDefinitionRepository,
  WorkflowInstanceRepository,
} from "../../src/application/workflow/workflow-ports";

const ORG = "org-wf01";

function makeWorld() {
  const versions = new Map<string, WorkflowDefinitionVersionView>();
  const known = new Set<string>([`${ORG}/research-to-brief`]);
  const definitions: WorkflowDefinitionRepository = {
    definitionExists: async (org, key) => known.has(`${org}/${key}`),
    findVersion: async (org, key, v) => versions.get(`${org}/${key}/${v}`) ?? null,
    latestPublishedVersion: async (org, key) => {
      const vs = [...versions.values()].filter((d) => d.key === key && d.status === "published" && versions.get(`${org}/${key}/${d.version}`));
      return vs.length ? Math.max(...vs.map((d) => d.version)) : null;
    },
    insertPublished: async (org, view) => {
      const k = `${org}/${view.key}/${view.version}`;
      if (versions.has(k)) throw new Error("duplicate version");
      versions.set(k, view);
    },
  };
  const instanceRows = new Map<string, PinnedWorkflowInstance>();
  const instances: WorkflowInstanceRepository = {
    create: async (i) => void instanceRows.set(`${i.orgId}/${i.instanceId}`, i),
    find: async (org, id) => instanceRows.get(`${org}/${id}`) ?? null,
  };
  const graphs = new Map<string, string[]>([
    ["research-to-brief:1", ["collect", "draft"]],
    ["research-to-brief:2", ["collect", "draft", "review"]],
  ]);
  const skillVersions = new Map<string, string[]>([
    ["skill.research", ["1.0.0", "1.2.0"]],
    ["skill.brief", ["1.0.0"]],
  ]);
  const skills = {
    resolve: async (_org: string, id: string, range: string) => {
      const vs = skillVersions.get(id) ?? [];
      const hit = range.startsWith("^") ? vs.filter((v) => v.split(".")[0] === range.slice(1).split(".")[0]) : vs.filter((v) => v === range);
      return hit.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1) ?? null;
    },
  };
  let n = 0;
  const deps = {
    definitions,
    instances,
    skills,
    graphs: { nodeIdsOf: (ref: string) => graphs.get(ref) ?? null },
    clock: { nowIso: () => "2026-09-28T00:00:00.000Z" },
    newId: () => `wi-${++n}`,
  };
  return { deps, skillVersions, graphs, instanceRows };
}

const stage = (stageId: string, skills: { stableId: string; versionRange: string }[]) => ({
  stageId,
  title: stageId,
  skills,
  capabilityCategories: [],
  sideEffect: "none",
  humanGate: null,
  maxAttempts: 2,
});

const v1 = {
  key: "research-to-brief",
  version: 1,
  graphRef: "research-to-brief:1",
  title: "Research to brief",
  inputSchema: { type: "object" },
  stages: [stage("collect", [{ stableId: "skill.research", versionRange: "^1" }]), stage("draft", [{ stableId: "skill.brief", versionRange: "1.0.0" }])],
};
const v2 = {
  ...v1,
  version: 2,
  graphRef: "research-to-brief:2",
  stages: [
    stage("collect", [{ stableId: "skill.research", versionRange: "^2" }]),
    stage("draft", [{ stableId: "skill.brief", versionRange: "1.0.0" }]),
    stage("review", []),
  ],
};

async function expectCode(p: Promise<unknown>, code: string) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(WorkflowUseCaseError);
  expect((err as WorkflowUseCaseError).code).toBe(code);
  return err as WorkflowUseCaseError;
}

describe("WF01 publish validation", () => {
  it("publishes a valid version as published and immutable", async () => {
    const { deps } = makeWorld();
    const view = await publishDefinitionVersion(deps, { orgId: ORG, pathKey: "research-to-brief", body: v1 });
    expect(view.status).toBe("published");
    expect(view.publishedAt).toBe("2026-09-28T00:00:00.000Z");
    expect(Object.isFrozen(view.stages[0])).toBe(true);
    // 同内容重放幂等；不同内容覆盖同版本被拒（I-2）
    await expect(publishDefinitionVersion(deps, { orgId: ORG, pathKey: "research-to-brief", body: v1 })).resolves.toEqual(view);
    await expectCode(
      publishDefinitionVersion(deps, { orgId: ORG, pathKey: "research-to-brief", body: { ...v1, title: "changed" } }),
      "definition_invalid",
    );
  });

  it("rejects unregistered graph factory", async () => {
    const { deps } = makeWorld();
    const err = await expectCode(
      publishDefinitionVersion(deps, { orgId: ORG, pathKey: "research-to-brief", body: { ...v1, version: 9, graphRef: "research-to-brief:9" } }),
      "definition_invalid",
    );
    expect(err.details.issues).toContainEqual({ kind: "graph_not_registered", graphRef: "research-to-brief:9" });
  });

  it("rejects stages that do not map one-to-one to graph nodes", async () => {
    const { deps } = makeWorld();
    const err = await expectCode(
      publishDefinitionVersion(deps, { orgId: ORG, pathKey: "research-to-brief", body: { ...v1, stages: [v1.stages[0], stage("ghost", [])] } }),
      "definition_invalid",
    );
    expect(err.details.issues).toEqual(
      expect.arrayContaining([
        { kind: "stage_without_node", stageId: "ghost" },
        { kind: "node_without_stage", nodeId: "draft" },
      ]),
    );
  });

  it("rejects unresolvable skill references and unknown workflow keys", async () => {
    const { deps } = makeWorld();
    const err = await expectCode(publishDefinitionVersion(deps, { orgId: ORG, pathKey: "research-to-brief", body: v2 }), "definition_invalid");
    expect(err.details.missingSkills).toEqual(["skill.research@^2"]);
    await expectCode(publishDefinitionVersion(deps, { orgId: ORG, pathKey: "nope", body: { ...v1, key: "nope" } }), "workflow_not_found");
    await expectCode(publishDefinitionVersion(deps, { orgId: "org-other", pathKey: "research-to-brief", body: v1 }), "workflow_not_found");
    await expectCode(publishDefinitionVersion(deps, { orgId: ORG, pathKey: "research-to-brief", body: { ...v1, graphRef: "x:1" } }), "definition_invalid");
  });
});

describe("WF01 version pinning", () => {
  it("a v1 instance keeps v1 definition and its frozen skill versions after v2 is published", async () => {
    const { deps, skillVersions } = makeWorld();
    await publishDefinitionVersion(deps, { orgId: ORG, pathKey: "research-to-brief", body: v1 });
    const cmd = { orgId: ORG, key: "research-to-brief", agentId: "a1", agentVersionId: "av1", initiatorUserId: "u1", triggerKind: "manual" as const };
    const a = await createPinnedInstance(deps, cmd);
    expect(a.definitionVersion).toBe(1);
    expect(a.status).toBe("running");
    expect(a.stateVersion).toBe(1);
    expect(a.pinnedSkills).toEqual([
      { stageId: "collect", stableId: "skill.research", version: "1.2.0" },
      { stageId: "draft", stableId: "skill.brief", version: "1.0.0" },
    ]);
    expect(Object.isFrozen(a.pinnedSkills)).toBe(true);
    expect(() => {
      (a as { definitionVersion: number }).definitionVersion = 2;
    }).toThrow();

    // 新 Skill 版本 + v2 发布
    skillVersions.set("skill.research", ["1.0.0", "1.2.0", "1.9.0", "2.0.0"]);
    await publishDefinitionVersion(deps, { orgId: ORG, pathKey: "research-to-brief", body: v2 });

    const b = await createPinnedInstance(deps, cmd);
    expect(b.definitionVersion).toBe(2);
    expect(b.pinnedSkills.find((p) => p.stageId === "collect")?.version).toBe("2.0.0");

    // 在跑的 v1 实例：仍按 v1 定义 + 冻结的 1.2.0（而非新出现的 1.9.0）
    const plan = await loadPinnedExecutionPlan(deps, ORG, a.instanceId);
    expect(plan.definition.version).toBe(1);
    expect(plan.definition.stages.map((s) => s.stageId)).toEqual(["collect", "draft"]);
    expect(plan.skillsFor("collect")).toEqual([{ stageId: "collect", stableId: "skill.research", version: "1.2.0" }]);

    // 显式指定旧版本仍可启动；未发布版本被拒
    expect((await createPinnedInstance(deps, { ...cmd, version: 1 })).definitionVersion).toBe(1);
    await expectCode(createPinnedInstance(deps, { ...cmd, version: 3 }), "workflow_version_not_published");
  });

  it("refuses to start when a skill reference no longer resolves", async () => {
    const { deps, skillVersions, instanceRows } = makeWorld();
    await publishDefinitionVersion(deps, { orgId: ORG, pathKey: "research-to-brief", body: v1 });
    skillVersions.set("skill.brief", []);
    const err = await expectCode(
      createPinnedInstance(deps, { orgId: ORG, key: "research-to-brief", agentId: "a1", agentVersionId: "av1", initiatorUserId: "u1", triggerKind: "manual" }),
      "skill_version_unresolved",
    );
    expect(err.details.missingSkills).toEqual(["skill.brief@1.0.0"]);
    expect(instanceRows.size).toBe(0);
  });
});
