/**
 * research-workflow-definitions.test.ts —— Phase 20 CT02（05-content-lines.md R3 步骤 2 / R4 E2；
 * 契约束 work-content UC-WC-I3、I-C4、I-C5）。
 *
 * 断言：五个研究线 Workflow 的代码定义图与 §5 阶段表一致、每个版本固定 Skill semanticVersion、
 * 目录条目满足 WorkflowCatalogItem 契约；注册时任一 pin 不在目录 / 门状态低于 G2 →
 * 该 Workflow unavailable + workflow_skill_pin_unresolved + unresolvedPins，其它 Workflow 不受影响，
 * 且不可用的 Workflow 不进 runtime 图注册表。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WorkflowCatalogItem } from "@repo/contracts/work-content";
import { RESEARCH_WORKFLOW_DEFINITIONS } from "../../src/domain/work-content/definitions";
import {
  graphRefOf,
  resolveWorkflowCatalog,
  skillPinsOf,
  type PinnedSkillCatalogState,
  type SkillPinLookup,
} from "../../src/domain/work-content/workflow-definition";
import { registerWorkContentWorkflows } from "../../src/infrastructure/workflow/work-content-graphs";
import { WorkflowGraphRegistry } from "../../src/infrastructure/workflow/workflow-graph-registry";

const REPO = resolve(__dirname, "../../../..");
const PACK = JSON.parse(readFileSync(resolve(REPO, "skills/starter-packs/work-research/1.0.0.json"), "utf8")) as {
  skills: { name: string; semanticVersion: string }[];
};

const PASSED: PinnedSkillCatalogState = {
  channel: "candidate",
  gates: (["G0", "G1", "G2"] as const).map((gate) => ({ gate, state: "passed" as const, evidenceRef: "e" })),
};

/** 目录 = starter-pack 中的 Skill 版本，全部过 G0–G2。 */
function catalogFromPack(overrides: Record<string, PinnedSkillCatalogState | null> = {}): SkillPinLookup {
  const rows = new Map(PACK.skills.map((s) => [`${s.name}@${s.semanticVersion}`, PASSED]));
  return (id, v) => {
    if (id in overrides) return overrides[id] ?? null;
    return rows.get(`${id}@${v}`) ?? null;
  };
}

function stageTable(file: string): string[] {
  const text = readFileSync(resolve(REPO, "requirements/work-stack-v2/workflows", file), "utf8");
  const section = text.split(/^## 5\./m)[1]!.split(/^## 6\./m)[0]!;
  return [...section.matchAll(/^\| \d+[ab]? \| ([a-z_]+) \|/gm)].map((m) => m[1]!);
}

const DOCS: Record<string, string> = {
  W001: "W001-research-to-brief.md",
  W006: "W006-knowledge-capture-loop.md",
  W009: "W009-evidence-to-recommendation.md",
  W057: "W057-question-to-analysis.md",
  W060: "W060-research-to-evidence.md",
};

describe("CT02 研究线 Workflow 定义", () => {
  it("恰好五个：W001/W006/W009/W057/W060，graphRef 唯一", () => {
    expect(RESEARCH_WORKFLOW_DEFINITIONS.map((d) => d.id).sort()).toEqual(["W001", "W006", "W009", "W057", "W060"]);
    const refs = RESEARCH_WORKFLOW_DEFINITIONS.map(graphRefOf);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it.each(RESEARCH_WORKFLOW_DEFINITIONS.map((d) => [d.id, d] as const))("%s 阶段顺序 = 文档 §5 阶段表", (id, def) => {
    expect(def.stages.map((s) => s.stageId)).toEqual(stageTable(DOCS[id]!));
    for (const g of def.gates) expect(def.stages.some((s) => s.stageId === g.stageId)).toBe(true);
  });

  it("每个 pin 固定具体 semanticVersion 且等于 starter-pack 中该 Skill 的版本", () => {
    const packVersion = new Map(PACK.skills.map((s) => [s.name, s.semanticVersion]));
    for (const def of RESEARCH_WORKFLOW_DEFINITIONS) {
      for (const pin of skillPinsOf(def)) {
        expect(pin.semanticVersion).toMatch(/^\d+\.\d+\.\d+$/);
        expect(pin.semanticVersion, `${def.id} ${pin.skillId}`).toBe(packVersion.get(pin.skillId));
      }
    }
  });

  it("全部 pin 已 PASS 入目录 → 五个都 available，且满足 WorkflowCatalogItem 契约", () => {
    const catalog = resolveWorkflowCatalog(RESEARCH_WORKFLOW_DEFINITIONS, catalogFromPack());
    for (const item of catalog) {
      expect(() => WorkflowCatalogItem.parse(item)).not.toThrow();
      expect(item.availability).toBe("available");
      expect(item.unavailableReason).toBeNull();
      expect(item.unresolvedPins).toEqual([]);
    }
  });

  it("E2：S171 不在目录 → 用到它的 W001/W009/W060 不可用并列出该 pin，W006/W057 不受影响", () => {
    const catalog = resolveWorkflowCatalog(RESEARCH_WORKFLOW_DEFINITIONS, catalogFromPack({ S171: null }));
    const by = new Map(catalog.map((c) => [c.workflowId, c]));
    for (const id of ["W001", "W009", "W060"]) {
      const c = by.get(id)!;
      expect(c.availability).toBe("unavailable");
      expect(c.unavailableReason).toBe("workflow_skill_pin_unresolved");
      expect(c.unresolvedPins).toEqual([{ skillId: "S171", semanticVersion: "1.0.0" }]);
      expect(() => WorkflowCatalogItem.parse(c)).not.toThrow();
    }
    for (const id of ["W006", "W057"]) expect(by.get(id)!.availability).toBe("available");
  });

  it("E2：门状态低于 G2（G2 未过）或已 deprecated → 不可解析", () => {
    const belowG2: PinnedSkillCatalogState = {
      channel: "candidate",
      gates: [
        { gate: "G0", state: "passed", evidenceRef: null },
        { gate: "G1", state: "passed", evidenceRef: null },
        { gate: "G2", state: "failed", evidenceRef: null },
      ],
    };
    const c1 = resolveWorkflowCatalog(RESEARCH_WORKFLOW_DEFINITIONS, catalogFromPack({ S157: belowG2 }));
    expect(c1.find((c) => c.workflowId === "W057")!.unresolvedPins.map((p) => p.skillId)).toEqual(["S157"]);
    expect(c1.filter((c) => c.availability === "unavailable").map((c) => c.workflowId)).toEqual(["W057"]);
    const c2 = resolveWorkflowCatalog(RESEARCH_WORKFLOW_DEFINITIONS, catalogFromPack({ S016: { ...PASSED, channel: "deprecated" } }));
    expect(c2.filter((c) => c.availability === "unavailable").map((c) => c.workflowId)).toEqual(["W006"]);
  });

  it("E2：pin 的版本在目录里不存在（只有别的版本）→ 不可解析", () => {
    const lookup: SkillPinLookup = (id, v) => (id === "S020" && v === "1.0.0" ? null : catalogFromPack()(id, v));
    const c = resolveWorkflowCatalog(RESEARCH_WORKFLOW_DEFINITIONS, lookup);
    expect(c.filter((x) => x.availability === "unavailable").map((x) => x.workflowId)).toEqual(["W001"]);
  });

  it("Runtime 注册：只有 available 的 Workflow 进图注册表，节点 = 阶段", () => {
    const { catalog, graphs } = registerWorkContentWorkflows(RESEARCH_WORKFLOW_DEFINITIONS, catalogFromPack({ S171: null }));
    const registry = new WorkflowGraphRegistry(graphs);
    for (const def of RESEARCH_WORKFLOW_DEFINITIONS) {
      const item = catalog.find((c) => c.workflowId === def.id)!;
      const nodes = registry.nodeIdsOf(graphRefOf(def));
      if (item.availability === "available") expect(nodes).toEqual(def.stages.map((s) => s.stageId));
      else expect(nodes).toBeNull();
    }
    expect(graphs).toHaveLength(2);
  });
});
