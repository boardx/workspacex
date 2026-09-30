/**
 * batch2-skillpins-matrix.test.ts —— 批次 2 组合单源（V8 / I-C1 / I-C2）。
 *
 * 每个批次 2 Workflow 的 skillPins（由阶段表派生）的 Skill ID 集合 = WORKFLOW-SKILL-MATRIX.md 对应行；
 * pin 版本 = 该 Skill 所在 starter-pack 的 `semanticVersion`（唯一例外：S019 尚无 Skill 包，登记为未解析）；
 * W017 不得出现。纯函数 + 文件系统，不连数据库。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { OPERATIONS_WORKFLOW_DEFINITIONS } from "../../src/domain/work-content/definitions/operations";
import { SHARED_WORKFLOW_DEFINITIONS } from "../../src/domain/work-content/definitions/shared";
import { BATCH2_SKILL_VERSIONS } from "../../src/domain/work-content/definitions/batch2/stage-builder";
import { skillPinsOf } from "../../src/domain/work-content/workflow-definition-module";
import { REPO } from "./batch2-workflow-docs";

const MATRIX = resolve(REPO, "requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md");
const ALL = [...SHARED_WORKFLOW_DEFINITIONS, ...OPERATIONS_WORKFLOW_DEFINITIONS];

function matrixRows(): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const line of readFileSync(MATRIX, "utf8").split("\n")) {
    const m = /^\|\s*(W\d{3})\s*\|[^|]*\|[^|]*\|([^|]*)\|/.exec(line);
    if (m) rows.set(m[1]!, m[2]!.split(",").map((s) => s.trim()).filter(Boolean));
  }
  return rows;
}

function packVersions(): Map<string, Set<string>> {
  const root = resolve(REPO, "skills/starter-packs");
  const out = new Map<string, Set<string>>();
  for (const dir of readdirSync(root).filter((d) => d.startsWith("work-"))) {
    for (const file of readdirSync(resolve(root, dir))) {
      const pack = JSON.parse(readFileSync(resolve(root, dir, file), "utf8")) as { skills: { name: string; semanticVersion: string }[] };
      for (const s of pack.skills) (out.get(s.name) ?? out.set(s.name, new Set()).get(s.name)!).add(s.semanticVersion);
    }
  }
  return out;
}

describe("批次 2 skillPins = WORKFLOW-SKILL-MATRIX 对应行", () => {
  const rows = matrixRows();

  it("恰好覆盖 W003/W004/W007/W052/W053/W055/W056，不含 W017", () => {
    expect(ALL.map((d) => d.workflowId)).toEqual(["W003", "W004", "W007", "W052", "W053", "W055", "W056"]);
    expect(ALL.map((d) => d.workflowId)).not.toContain("W017");
  });

  for (const def of ALL) {
    it(`${def.workflowId} 的 skillPins 集合等于矩阵行`, () => {
      const row = rows.get(def.workflowId);
      expect(row, `矩阵缺 ${def.workflowId} 行`).toBeDefined();
      const pins = skillPinsOf(def).map((p) => p.skillId);
      expect(new Set(pins).size).toBe(pins.length);
      expect([...pins].sort()).toEqual([...row!].sort());
    });
  }

  it("每个 pin 固定到 starter-pack 中该 Skill 的 semanticVersion；包外的 pin 只允许 S019", () => {
    const versions = packVersions();
    const outside = new Set<string>();
    for (const def of ALL) {
      for (const pin of skillPinsOf(def)) {
        expect(pin.semanticVersion).toMatch(/^\d+\.\d+\.\d+$/);
        const known = versions.get(pin.skillId);
        if (!known) outside.add(pin.skillId);
        else expect(known.has(pin.semanticVersion), `${def.workflowId}/${pin.skillId}@${pin.semanticVersion}`).toBe(true);
      }
    }
    expect([...outside]).toEqual(["S019"]);
  });

  it("版本表里没有多余项（每一项都被某个 Workflow 使用），也没有缺项", () => {
    const used = new Set(ALL.flatMap((d) => skillPinsOf(d).map((p) => p.skillId)));
    expect([...used].sort()).toEqual(Object.keys(BATCH2_SKILL_VERSIONS).sort());
  });

  it("跨线引用：W003 引用 S012(research)/S142(product)，W007 引用 S011/S015(resolution)，W056 引用 S179(engineering)", () => {
    const pinsOf = (id: string) => skillPinsOf(ALL.find((d) => d.workflowId === id)!).map((p) => p.skillId);
    expect(pinsOf("W003")).toEqual(expect.arrayContaining(["S012", "S142"]));
    expect(pinsOf("W007")).toEqual(expect.arrayContaining(["S011", "S015", "S187", "S189", "S190"]));
    expect(pinsOf("W056")).toEqual(expect.arrayContaining(["S179", "S177"]));
  });
});
