/**
 * sales-skillpins-matrix.test.ts —— Phase 20 CT08（`05-content-lines.md` R3 步骤 7；V8 / I-C1 / I-C2）。
 *
 * 组合单源：每个销售线 Workflow 定义的 skillPins（由阶段表派生）的 Skill ID 集合 = WORKFLOW-SKILL-MATRIX.md
 * 对应行；pin 的版本 = work-sales 包（CT07）中该 Skill 的 semanticVersion；W017 不得出现。
 * 纯函数 + 文件系统，不连数据库。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SALES_WORKFLOW_DEFINITIONS } from "../../src/domain/work-content/definitions/sales";
import { skillPinsOf } from "../../src/domain/work-content/workflow-definition-module";
import { buildWorkSalesPack } from "../../scripts/build-work-sales-skill-pack";

const MATRIX = resolve(__dirname, "../../../../requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md");

function matrixRows(): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const line of readFileSync(MATRIX, "utf8").split("\n")) {
    const m = /^\|\s*(W\d{3})\s*\|[^|]*\|[^|]*\|([^|]*)\|/.exec(line);
    if (m) rows.set(m[1]!, m[2]!.split(",").map((s) => s.trim()).filter(Boolean));
  }
  return rows;
}

describe("CT08 · 销售线 skillPins = WORKFLOW-SKILL-MATRIX 对应行", () => {
  const rows = matrixRows();

  it("恰好覆盖 W011–W016 与 W018，不含 W017", () => {
    expect(SALES_WORKFLOW_DEFINITIONS.map((d) => d.workflowId)).toEqual(["W011", "W012", "W013", "W014", "W015", "W016", "W018"]);
  });

  for (const def of SALES_WORKFLOW_DEFINITIONS) {
    it(`${def.workflowId} 的 skillPins 集合等于矩阵行`, () => {
      const row = rows.get(def.workflowId);
      expect(row, `矩阵缺 ${def.workflowId} 行`).toBeDefined();
      const pins = skillPinsOf(def).map((p) => p.skillId);
      expect(new Set(pins).size).toBe(pins.length);
      expect([...pins].sort()).toEqual([...row!].sort());
    });
  }

  it("跨线引用：W013 引用 S009，W018 引用 S035/S036/S009，W016 引用 S010/S033", () => {
    const pinsOf = (id: string) => skillPinsOf(SALES_WORKFLOW_DEFINITIONS.find((d) => d.workflowId === id)!).map((p) => p.skillId);
    expect(pinsOf("W013")).toContain("S009");
    expect(pinsOf("W018")).toEqual(expect.arrayContaining(["S035", "S036", "S009"]));
    expect(pinsOf("W016")).toEqual(expect.arrayContaining(["S010", "S033"]));
  });

  it("每个 pin 固定到 work-sales 包中该 Skill 的 semanticVersion（包外的 pin 只允许 S027，且登记为未解析）", () => {
    const versions = new Map(buildWorkSalesPack().skills.map((s) => [s.name, s.semanticVersion]));
    const outside = new Set<string>();
    for (const def of SALES_WORKFLOW_DEFINITIONS) {
      for (const pin of skillPinsOf(def)) {
        const v = versions.get(pin.skillId);
        if (v === undefined) outside.add(pin.skillId);
        else expect(pin.semanticVersion, `${def.workflowId}/${pin.skillId}`).toBe(v);
      }
    }
    expect([...outside]).toEqual(["S027"]);
  });
});
