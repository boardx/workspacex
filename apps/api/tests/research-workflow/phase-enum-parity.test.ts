/**
 * 阶段/三态/拒绝码枚举的**两处一致**机械核对。
 *
 * 契约（`packages/contracts/src/research-workflow.ts`）是唯一事实源，但迁移里的
 * CHECK 约束不得不复述一遍字符串——库无法 import TypeScript。这就制造了本项目
 * 点名"已五次因此漂移"的那个形状：两份都自洽、都看着对，改一处忘另一处不会有
 * 任何东西变红。
 *
 * 所以这份测试存在。它不是可选的补充，它是那条复述被允许存在的**前提**：
 * 契约加一个阶段而迁移没跟上（或反之），这里立刻红。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { researchWorkflow as C } from "@repo/contracts";

const MIGRATION = readFileSync(
  join(__dirname, "../../migrations/20260916010000_research_workflow_sessions.sql"),
  "utf8",
);

/** 从 `CHECK (col IN ('a','b'))` 里取出那串字面量。 */
function checkValues(constraintName: string): string[] {
  const m = MIGRATION.match(new RegExp(`CONSTRAINT ${constraintName} CHECK \\([^)]*IN \\(([^)]*)\\)`, "s"));
  if (!m) throw new Error(`迁移里找不到约束 ${constraintName}——它被删了或改名了`);
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort();
}

describe("契约 ↔ 迁移 枚举一致", () => {
  it("阶段集合逐字相同", () => {
    expect(checkValues("research_session_phase_known")).toEqual([...C.RESEARCH_PHASES].sort());
  });

  it("材料三态集合逐字相同", () => {
    expect(checkValues("research_material_verdict_known")).toEqual([...C.MATERIAL_VERDICTS].sort());
  });

  it("材料来源集合逐字相同", () => {
    expect(checkValues("research_material_source_known")).toEqual([...C.MATERIAL_SOURCES].sort());
  });

  it("预测判定三档集合逐字相同", () => {
    expect(checkValues("research_prediction_verdict_known")).toEqual([...C.PREDICTION_VERDICTS].sort());
  });

  it("根因分类集合逐字相同", () => {
    expect(checkValues("research_prediction_root_cause_known")).toEqual([...C.ROOT_CAUSES].sort());
  });

  it("回填「只填一半」的数据层保险还在", () => {
    // 只填实际值不填判定，看起来像"填了"，实际无法参与统计。CHECK 让它写不进来。
    expect(MIGRATION).toContain("research_prediction_filled_shape");
  });

  it("每档判定与每种根因都有中文名", () => {
    for (const v of C.PREDICTION_VERDICTS) expect(C.PREDICTION_VERDICT_LABELS[v]).toBeTruthy();
    for (const r of C.ROOT_CAUSES) expect(C.ROOT_CAUSE_LABELS[r]).toBeTruthy();
  });

  it("每个阶段都有中文名（阶段条不会渲染出一个空标签）", () => {
    for (const p of C.RESEARCH_PHASES) expect(C.PHASE_LABELS[p]).toBeTruthy();
  });

  it("每道门与每个拒绝码都有中文名", () => {
    for (const g of C.RESEARCH_GATES) expect(C.GATE_LABELS[g]).toBeTruthy();
    for (const r of C.RESEARCH_REFUSALS) expect(C.REFUSAL_LABELS[r]).toBeTruthy();
  });

  it("数据层保险还在：已发布图谱必须有材料批次", () => {
    // 这条 CHECK 是「不得自动发布」在应用层之外的最后一道防线。
    // 有人为了跑通某个测试顺手删掉它时，这里会红。
    expect(MIGRATION).toContain("research_session_published_needs_batch");
    expect(MIGRATION).toMatch(/published_graph_version = 0 OR material_batch_id IS NOT NULL/);
  });

  it("越权尝试必须留痕：审计表存在且拒绝行必须带原因码", () => {
    expect(MIGRATION).toContain("research_gate_audit");
    expect(MIGRATION).toContain("research_gate_audit_refusal_shape");
  });
});
