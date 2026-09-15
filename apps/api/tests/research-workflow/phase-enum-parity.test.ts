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
import { readFileSync, readdirSync } from "node:fs";
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

/**
 * 2026-09-15 实测：本迁移第一版写了 `REFERENCES threads(id)`（不存在，表叫
 * `chat_threads`）且把 `thread_id`/`org_id` 声明成 `uuid`（本仓这两列都是 `text`）。
 * 结果是 **`migrateOnce()` 直接失败**，CI 里几十个数据库测试一起红，而本地
 * 没有 Docker 跑不到迁移——tsc / eslint / 所有纯函数测试全绿。
 *
 * 这几条静态断言不替代真的跑一次迁移，但它们在**任何机器上**都能跑，
 * 把"引用了一个不存在的表"这类错误挡在推送之前。
 */
describe("迁移引用的表与类型真实存在", () => {
  const ALL_MIGRATIONS = readdirSync(join(__dirname, "../../migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(__dirname, "../../migrations", f), "utf8"))
    .join("\n");

  it.each([...MIGRATION.matchAll(/REFERENCES\s+(\w+)\s*\(/g)].map((m) => m[1]!))(
    "被引用的表 %s 在某个迁移里真的被 CREATE 过",
    (table) => {
      expect(ALL_MIGRATIONS).toMatch(new RegExp(`CREATE TABLE (IF NOT EXISTS )?${table}\\b`));
    },
  );

  it("thread_id 一律是 text（chat_threads.id 是 text，写成 uuid 会让迁移直接失败）", () => {
    for (const m of MIGRATION.matchAll(/^\s*thread_id\s+(\w+)/gm)) {
      expect(m[1], `thread_id 被声明成了 ${m[1]}`).toBe("text");
    }
  });

  it("org_id 一律是 text 且引用 organizations", () => {
    const decls = [...MIGRATION.matchAll(/^\s*org_id\s+(\w+)[^,]*/gm)];
    expect(decls.length).toBeGreaterThan(0);
    for (const m of decls) {
      expect(m[1], `org_id 被声明成了 ${m[1]}`).toBe("text");
      expect(m[0]).toContain("REFERENCES organizations");
    }
  });

  it("契约里的 threadId 不是 .uuid()（chat 线程 id 不是 uuid，多这条约束会让请求全部 400）", () => {
    const src = readFileSync(
      join(__dirname, "../../../../packages/contracts/src/research-workflow.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/threadId:\s*z\.string\(\)\.uuid\(\)/);
  });
});

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
