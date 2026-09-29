/**
 * skillpins-matrix-closure.test.ts —— Phase 20 CT02 / V8 矩阵闭合 lint（契约束 work-content I-C1）。
 *
 * 每个研究线 Workflow 定义的 skillPins 的 Skill ID 集合 = WORKFLOW-SKILL-MATRIX.md 对应行（组合单源）；
 * 且每个 pin 的 Skill 都在已 PASS 的第一阶段清单里（I-C2）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RESEARCH_WORKFLOW_DEFINITIONS } from "../../src/domain/work-content/definitions";
import { skillPinsOf, type WorkContentWorkflowDefinition } from "../../src/domain/work-content/workflow-definition";

const REPO = resolve(__dirname, "../../../..");
const V2 = resolve(REPO, "requirements/work-stack-v2");

function matrixRows(): Map<string, string[]> {
  const text = readFileSync(resolve(V2, "WORKFLOW-SKILL-MATRIX.md"), "utf8");
  const rows = new Map<string, string[]>();
  for (const m of text.matchAll(/^\| (W\d{3}) \|[^|]*\|[^|]*\| ([^|]*)\|/gm)) {
    rows.set(m[1]!, m[2]!.split(",").map((s) => s.trim()).filter(Boolean));
  }
  return rows;
}

export function matrixClosureIssues(defs: readonly WorkContentWorkflowDefinition[], rows: Map<string, string[]>): string[] {
  const issues: string[] = [];
  for (const def of defs) {
    const row = rows.get(def.id);
    if (!row) {
      issues.push(`${def.id}: not in WORKFLOW-SKILL-MATRIX.md`);
      continue;
    }
    const pins = new Set(skillPinsOf(def).map((p) => p.skillId));
    for (const s of row) if (!pins.has(s)) issues.push(`${def.id}: matrix skill ${s} missing from skillPins`);
    for (const s of pins) if (!row.includes(s)) issues.push(`${def.id}: skillPin ${s} not in matrix row`);
  }
  return issues;
}

describe("CT02 V8 skillPins = WORKFLOW-SKILL-MATRIX.md 对应行", () => {
  const rows = matrixRows();

  it("矩阵可解析且含五个研究线 Workflow 行", () => {
    for (const id of ["W001", "W006", "W009", "W057", "W060"]) expect(rows.get(id)?.length).toBeGreaterThan(0);
  });

  it.each(RESEARCH_WORKFLOW_DEFINITIONS.map((d) => [d.id, d] as const))("%s skillPins 集合 = 矩阵行", (id, def) => {
    expect(skillPinsOf(def).map((p) => p.skillId).sort()).toEqual([...rows.get(id)!].sort());
  });

  it("闭合 lint 无问题", () => {
    expect(matrixClosureIssues(RESEARCH_WORKFLOW_DEFINITIONS, rows)).toEqual([]);
  });

  it("闭合 lint 能抓出漂移：多一个 / 少一个 Skill", () => {
    const w001 = RESEARCH_WORKFLOW_DEFINITIONS.find((d) => d.id === "W001")!;
    const extra: WorkContentWorkflowDefinition = {
      ...w001,
      skillVersions: { ...w001.skillVersions, S012: "1.0.0" },
      stages: [...w001.stages, { stageId: "extra", title: "x", skills: ["S012"] }],
    };
    expect(matrixClosureIssues([extra], rows)).toEqual(["W001: skillPin S012 not in matrix row"]);
    const { S010: _drop, ...rest } = w001.skillVersions;
    const missing: WorkContentWorkflowDefinition = {
      ...w001,
      skillVersions: rest,
      stages: w001.stages.map((s) => ({ ...s, skills: s.skills.filter((k) => k !== "S010") })),
    };
    expect(matrixClosureIssues([missing], rows)).toEqual(["W001: matrix skill S010 missing from skillPins"]);
  });

  it("每个 pin 的 Skill 都在 WORK-STACK-320-LIST.md 里（只实现已列实体）", () => {
    const list = readFileSync(resolve(V2, "WORK-STACK-320-LIST.md"), "utf8");
    for (const def of RESEARCH_WORKFLOW_DEFINITIONS) {
      expect(list).toContain(def.id);
      for (const p of skillPinsOf(def)) expect(list, `${def.id} ${p.skillId}`).toContain(p.skillId);
    }
  });
});
