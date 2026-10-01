/**
 * product-skillpins-matrix.test.ts —— Phase 20 CT05（R7「组合只认两张矩阵」）。
 *
 * 每个产品线 Workflow 从阶段表派生的 skillPins 集合必须**等于** WORKFLOW-SKILL-MATRIX.md 对应行，
 * 且每个 pin 的 semanticVersion 等于 starter-pack 中该 Skill 的发布版本（ADR-118 #9）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PRODUCT_LINE_WORKFLOWS, skillPinsOf } from "../../src/domain/work-content/product-workflow-definitions";

const REPO = resolve(__dirname, "../../../..");

function matrixRows(): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  const text = readFileSync(resolve(REPO, "requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md"), "utf8");
  for (const line of text.split("\n")) {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length >= 4 && /^W\d{3}$/.test(cells[0]!)) rows.set(cells[0]!, cells[3]!.split(",").map((s) => s.trim()).filter(Boolean));
  }
  return rows;
}

function packVersions(): Map<string, string> {
  const m = new Map<string, string>();
  for (const pack of ["work-product", "work-research"]) {
    const json = JSON.parse(readFileSync(resolve(REPO, `skills/starter-packs/${pack}/1.0.0.json`), "utf8")) as {
      skills: { name: string; semanticVersion: string }[];
    };
    for (const s of json.skills) m.set(s.name, s.semanticVersion);
  }
  return m;
}

describe("CT05 · 产品线 skillPins == WORKFLOW-SKILL-MATRIX 对应行", () => {
  const rows = matrixRows();
  const versions = packVersions();

  it.each(PRODUCT_LINE_WORKFLOWS.map((w) => [w.workflowId, w] as const))("%s skillPins 集合等于矩阵行", (id, def) => {
    const row = rows.get(id);
    expect(row, `矩阵缺 ${id} 行`).toBeDefined();
    const pins = skillPinsOf(def);
    expect(pins.map((p) => p.skillId).sort()).toEqual([...row!].sort());
    expect(new Set(pins.map((p) => p.skillId)).size).toBe(pins.length);
  });

  it.each(PRODUCT_LINE_WORKFLOWS.map((w) => [w.workflowId, w] as const))("%s 每个 pin 固定到 pack 中已发布的版本", (_id, def) => {
    for (const pin of skillPinsOf(def)) {
      expect(versions.get(pin.skillId), pin.skillId).toBe(pin.semanticVersion);
    }
  });
});
