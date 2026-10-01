/**
 * product-workflow-definitions.test.ts —— Phase 20 CT05
 * （`05-content-lines.md` R3 步骤 5–6 / R4 E2·E3；契约束 `work-content`）。
 *
 * 断言：W027–W032 与 W002 的代码定义图与实体文档 §5 阶段表逐行对应、可通过 Runtime 发布校验；
 * Skill 版本固定到 starter-pack 版本；D011 白名单可发起 W027/W028/W029/W031/W002、不能发起 W030/W032
 * （可见失败 + 转交 D003）；注册时未解析的 Skill 引用使该 Workflow 不可用，其它 Workflow 不受影响（E2）。
 *
 * 纯函数 + 读仓库文件，不连数据库。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { WorkflowDefinitionVersionInput } from "@repo/contracts/workflow-runtime";
import { WorkflowCatalogItem } from "@repo/contracts/work-content";
import {
  PRODUCT_LINE_WORKFLOWS,
  toRuntimeDefinition,
} from "../../src/domain/work-content/product-workflow-definitions";
import {
  checkWorkflowAllowlisted,
  registerContentWorkflows,
  type CatalogSkillVersion,
} from "../../src/domain/work-content/content-workflow-registration";
import { WorkflowGraphRegistry } from "../../src/infrastructure/workflow/workflow-graph-registry";
import { defaultWorkflowGraphs } from "../../src/infrastructure/workflow/create-workflow-runtime";

const REPO = resolve(__dirname, "../../../..");
const V2 = resolve(REPO, "requirements/work-stack-v2");
const PRODUCT_IDS = ["W027", "W028", "W029", "W030", "W031", "W032", "W002"];

function packSkills(pack: string): CatalogSkillVersion[] {
  const json = JSON.parse(readFileSync(resolve(REPO, `skills/starter-packs/${pack}/1.0.0.json`), "utf8")) as {
    skills: { name: string; semanticVersion: string }[];
  };
  return json.skills.map((s) => ({ stableId: s.name, semanticVersion: s.semanticVersion, passedGates: ["G0", "G1", "G2", "G3", "G4", "G5"] }));
}
const CATALOG = [...packSkills("work-product"), ...packSkills("work-research")];

/** 独立从实体文档 §5 阶段表读出 stage 列（首个 token），与代码定义逐行比对。 */
function docStageIds(workflowId: string): string[] {
  const file = readdirSync(resolve(V2, "workflows")).find((f) => f.startsWith(`${workflowId}-`))!;
  const sec = readFileSync(resolve(V2, "workflows", file), "utf8").split("\n## 5")[1]!.split("\n## 6")[0]!;
  const ids: string[] = [];
  let header = true;
  for (const line of sec.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 7) continue;
    if (header) { header = false; continue; }
    if (/^[-: ]+$/.test(cells[0]!)) continue;
    ids.push(cells[1]!.split(/\s/)[0]!);
  }
  return ids;
}

/** 组合矩阵（DIGITALHUMAN-COMPOSITION-MATRIX.md）Workflows 列 = 角色白名单。 */
function roleAllowlists(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of readFileSync(resolve(V2, "DIGITALHUMAN-COMPOSITION-MATRIX.md"), "utf8").split("\n")) {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length >= 5 && /^D\d{3}$/.test(cells[0]!)) out[cells[0]!] = cells[2]!.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  }
  return out;
}

const graphs = new WorkflowGraphRegistry(defaultWorkflowGraphs());

describe("CT05 · 产品线 Workflow 定义（W027–W032/W002）", () => {
  it("恰好覆盖 7 个 Workflow，每个都通过 Runtime Definition 契约形状校验", () => {
    expect(PRODUCT_LINE_WORKFLOWS.map((w) => w.workflowId).sort()).toEqual([...PRODUCT_IDS].sort());
    for (const def of PRODUCT_LINE_WORKFLOWS) {
      expect(() => WorkflowDefinitionVersionInput.parse(toRuntimeDefinition(def))).not.toThrow();
    }
  });

  it("每个 Workflow 的阶段与实体文档 §5 阶段表逐行对应，代码图节点与阶段一一对应", () => {
    for (const def of PRODUCT_LINE_WORKFLOWS) {
      const docIds = docStageIds(def.workflowId);
      expect(docIds.length).toBeGreaterThan(0);
      expect(def.stages.map((s) => s.stageId), def.workflowId).toEqual(docIds);
      expect(graphs.nodeIdsOf(toRuntimeDefinition(def).graphRef)).toEqual(docIds);
    }
  });

  it("全部 Skill 版本已入目录且过 G2 时，7 个 Workflow 注册可用、Skill 版本固定到 pack 版本、目录条目合契约", () => {
    const registered = registerContentWorkflows(PRODUCT_LINE_WORKFLOWS, graphs, CATALOG);
    for (const r of registered) {
      expect(r.availability, r.workflowId).toBe("available");
      expect(r.unresolvedPins).toEqual([]);
      expect(r.graphIssues).toEqual([]);
      for (const pin of r.skillPins) {
        expect(CATALOG.find((c) => c.stableId === pin.skillId)?.semanticVersion).toBe(pin.semanticVersion);
      }
      const { graphIssues: _g, ...item } = r;
      expect(() => WorkflowCatalogItem.parse(item)).not.toThrow();
    }
  });

  it("E2：某 Workflow 固定的 Skill 不在目录 → 仅该 Workflow 不可用（workflow_skill_pin_unresolved），其它不受影响", () => {
    const catalog = CATALOG.filter((c) => c.stableId !== "S155"); // 只有 W032 引用 S155
    const registered = registerContentWorkflows(PRODUCT_LINE_WORKFLOWS, graphs, catalog);
    const w032 = registered.find((r) => r.workflowId === "W032")!;
    expect(w032.availability).toBe("unavailable");
    expect(w032.unavailableReason).toBe("workflow_skill_pin_unresolved");
    expect(w032.unresolvedPins).toEqual([{ skillId: "S155", semanticVersion: "1.0.0" }]);
    for (const r of registered.filter((x) => x.workflowId !== "W032")) expect(r.availability, r.workflowId).toBe("available");
  });

  it("E2：门状态低于 G2 或版本不符同样视为未解析", () => {
    const belowG2 = CATALOG.map((c) => (c.stableId === "S006" ? { ...c, passedGates: ["G0", "G1"] } : c));
    const r1 = registerContentWorkflows(PRODUCT_LINE_WORKFLOWS, graphs, belowG2);
    expect(r1.find((r) => r.workflowId === "W002")!.unresolvedPins.map((p) => p.skillId)).toEqual(["S006"]);
    expect(r1.filter((r) => r.availability === "unavailable").map((r) => r.workflowId)).toEqual(["W002"]);
    const wrongVersion = CATALOG.map((c) => (c.stableId === "S067" ? { ...c, semanticVersion: "2.0.0" } : c));
    const r2 = registerContentWorkflows(PRODUCT_LINE_WORKFLOWS, graphs, wrongVersion);
    expect(r2.filter((r) => r.availability === "unavailable").map((r) => r.workflowId).sort()).toEqual(["W029", "W030"]);
  });

  it("未注册图工厂的 Workflow 不可用，不影响其它", () => {
    const partial = new WorkflowGraphRegistry(defaultWorkflowGraphs().filter((g) => !g.graphRef.startsWith("experiment-loop:")));
    const registered = registerContentWorkflows(PRODUCT_LINE_WORKFLOWS, partial, CATALOG);
    expect(registered.filter((r) => r.availability === "unavailable").map((r) => r.workflowId)).toEqual(["W031"]);
  });

  it("E3：D011 可发起 W027/W028/W029/W031/W002，不能发起 W030/W032（可见失败 + 可转交 D003）", () => {
    const allowlists = roleAllowlists();
    for (const w of ["W027", "W028", "W029", "W031", "W002"]) expect(checkWorkflowAllowlisted("D011", w, allowlists)).toEqual({ ok: true });
    for (const w of ["W030", "W032"]) {
      const d = checkWorkflowAllowlisted("D011", w, allowlists);
      expect(d.ok).toBe(false);
      if (!d.ok) {
        expect(d.code).toBe("workflow_not_allowlisted");
        expect(d.requestedWorkflowId).toBe(w);
        expect(d.handoffCandidates).toContain("D003");
      }
    }
    for (const w of ["W027", "W028", "W029", "W030", "W031", "W032"]) expect(checkWorkflowAllowlisted("D003", w, allowlists).ok).toBe(true);
  });
});
