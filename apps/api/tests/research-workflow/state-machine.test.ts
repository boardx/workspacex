/**
 * 研判工作流状态机——门的**反证式**测试。
 *
 * ## 这份测试的写法为什么和别处不同
 *
 * 门控测试最容易写成自我安慰：挑几条顺手的路径走一遍，全绿，收工。可门的价值不在
 * "允许的能过"，而在"**不允许的过不去**"——而"不允许"的组合有几十种，随手挑三条
 * 试不出漏洞。所以这里**穷举**每一个 (阶段 × 目标阶段) 组合，对着状态机自己的表
 * 之外的所有组合断言被拒。
 *
 * 最关键的一条是 `不存在任何 Agent 路径可以到达两个门控阶段`：它不测某一条路，
 * 它测**整张图**。哪天有人给 AGENT_TRANSITIONS 加一条"顺手的捷径"，这条会红。
 */
import { describe, expect, it } from "vitest";
import { researchWorkflow as C } from "@repo/contracts";
import {
  decideAdvance,
  decideGate,
  decideRecollect,
  lineageAfterGate,
  pendingGate,
  type PhaseName,
  type SessionSnapshot,
} from "../../src/domain/research-workflow/state-machine";

const EMPTY_LINEAGE = {
  materialBatchId: null,
  fieldSchemeVersion: 0,
  logicVersion: 0,
  publishedGraphVersion: 0,
} as const;

function session(over: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return { phase: "empty", materials: [], lineage: EMPTY_LINEAGE, ...over };
}

const accepted = (n: number) =>
  Array.from({ length: n }, () => ({ verdict: "accepted" as const, attempts: 0 }));

/* ── 门①：材料 ──────────────────────────────────────────────────── */

describe("门① 材料确认", () => {
  it("材料逐条 accepted 时放行，并把阶段推到 materials_approved", () => {
    const s = session({ phase: "materials_review", materials: accepted(3) });
    expect(decideGate(s, "materials")).toEqual({ ok: true, nextPhase: "materials_approved" });
  });

  it("一条材料都没有就点通过 ⇒ NO_MATERIALS", () => {
    const s = session({ phase: "materials_review", materials: [] });
    expect(decideGate(s, "materials")).toEqual({ ok: false, refusal: "NO_MATERIALS" });
  });

  it.each(["pending", "missing", "wrong"] as const)(
    "还有一条材料是 %s 就点通过 ⇒ MATERIALS_UNRESOLVED（门不能整批一句「看着行」）",
    (verdict) => {
      const s = session({
        phase: "materials_review",
        materials: [...accepted(2), { verdict, attempts: 0 }],
      });
      expect(decideGate(s, "materials")).toEqual({ ok: false, refusal: "MATERIALS_UNRESOLVED" });
    },
  );

  it("不在 materials_review 阶段点这道门 ⇒ PHASE_MISMATCH", () => {
    const s = session({ phase: "collecting", materials: accepted(1) });
    expect(decideGate(s, "materials")).toEqual({ ok: false, refusal: "PHASE_MISMATCH" });
  });
});

/* ── 门②/门③：结论必须挂在过了门①的材料上 ──────────────────────── */

describe("门② 推理链 / 门③ 调整方案", () => {
  it("门②在没有材料批次血缘时被拒（没人审过材料就发布图谱，正是文档禁止的）", () => {
    const s = session({ phase: "graph_review", lineage: EMPTY_LINEAGE });
    expect(decideGate(s, "reasoning")).toEqual({ ok: false, refusal: "GATE_NOT_PASSED" });
  });

  it("门②在有材料批次血缘时放行到 graph_published", () => {
    const s = session({
      phase: "graph_review",
      lineage: { ...EMPTY_LINEAGE, materialBatchId: "b1" },
    });
    expect(decideGate(s, "reasoning")).toEqual({ ok: true, nextPhase: "graph_published" });
  });

  it("门③采纳后回到 graph_published", () => {
    const s = session({
      phase: "plan_review",
      lineage: { ...EMPTY_LINEAGE, materialBatchId: "b1" },
    });
    expect(decideGate(s, "plan")).toEqual({ ok: true, nextPhase: "graph_published" });
  });
});

/* ── 穷举：Agent 推进不了任何一道门 ──────────────────────────────── */

describe("Agent 侧推进", () => {
  /**
   * 整个设计的要害。不测某一条捷径，测整张图：
   * 从任意阶段出发、以任意阶段为目标，Agent 都到不了这两个门控阶段。
   */
  it.each(["materials_approved", "graph_published"] as const)(
    "不存在任何 Agent 路径可以到达 %s（只有人点门才到得了）",
    (gated) => {
      const reachable = C.RESEARCH_PHASES.filter((from) => {
        const s = session({
          phase: from,
          materials: accepted(2),
          // 血缘给满，排除"因为缺血缘才被拒"这种偶然通过的解释
          lineage: { materialBatchId: "b1", fieldSchemeVersion: 9, logicVersion: 9, publishedGraphVersion: 9 },
        });
        return decideAdvance(s, gated).ok;
      });
      expect(reachable).toEqual([]);
    },
  );

  it("跳门尝试的拒绝理由是 GATE_NOT_PASSED，不是笼统的 PHASE_MISMATCH（审计要能统计跳门次数）", () => {
    const s = session({ phase: "generating", materials: accepted(1) });
    expect(decideAdvance(s, "graph_published")).toEqual({ ok: false, refusal: "GATE_NOT_PASSED" });
  });

  it("穷举所有 (阶段 → 阶段) 组合：放行集合恰好等于允许表，不多一条", () => {
    const allowed: string[] = [];
    for (const from of C.RESEARCH_PHASES) {
      for (const to of C.RESEARCH_PHASES) {
        const s = session({ phase: from, materials: accepted(2) });
        if (decideAdvance(s, to).ok) allowed.push(`${from}->${to}`);
      }
    }
    expect(allowed.sort()).toEqual(
      [
        "awaiting_verification->backfilling",
        "backfilling->plan_review",
        "collecting->materials_review",
        "empty->collecting",
        "generating->graph_review",
        "graph_published->awaiting_verification",
        "graph_review->collecting",
        "graph_review->graph_review",
        "materials_approved->fields_pending",
        "materials_review->collecting",
        "plan_review->backfilling",
      ].sort(),
    );
  });

  it("没有材料就想进入待审 ⇒ NO_MATERIALS（空清单送审等于没送）", () => {
    expect(decideAdvance(session({ phase: "collecting" }), "materials_review")).toEqual({
      ok: false,
      refusal: "NO_MATERIALS",
    });
  });
});

/* ── 重采上限 ────────────────────────────────────────────────────── */

describe("重新采集次数", () => {
  it("未达上限时放行", () => {
    expect(decideRecollect(C.MAX_COLLECTION_ATTEMPTS - 1).ok).toBe(true);
  });

  it("达到上限即停 ⇒ ATTEMPTS_EXHAUSTED（活动图：两次失败即停）", () => {
    expect(decideRecollect(C.MAX_COLLECTION_ATTEMPTS)).toEqual({
      ok: false,
      refusal: "ATTEMPTS_EXHAUSTED",
    });
  });
});

/* ── 血缘 ────────────────────────────────────────────────────────── */

describe("过门后的血缘变化", () => {
  it("门①钉住材料批次，其余版本号不动", () => {
    expect(lineageAfterGate(EMPTY_LINEAGE, "materials", "batch-1")).toEqual({
      materialBatchId: "batch-1",
      fieldSchemeVersion: 0,
      logicVersion: 0,
      publishedGraphVersion: 0,
    });
  });

  it.each([
    ["fields", "fieldSchemeVersion"],
    ["logic", "logicVersion"],
    ["reasoning", "publishedGraphVersion"],
    ["plan", "publishedGraphVersion"],
  ] as const)("门 %s 只让 %s 加一", (gate, field) => {
    const before = { materialBatchId: "b1", fieldSchemeVersion: 1, logicVersion: 2, publishedGraphVersion: 3 };
    const after = lineageAfterGate(before, gate, "unused");
    expect(after[field]).toBe(before[field] + 1);
    // 其余字段一个都不许动——版本号乱跳会让三个月后的根因定位失效
    const others = (["fieldSchemeVersion", "logicVersion", "publishedGraphVersion"] as const).filter((f) => f !== field);
    for (const o of others) expect(after[o]).toBe(before[o]);
  });
});

/* ── 界面读的「现在轮到谁」 ──────────────────────────────────────── */

describe("pendingGate", () => {
  it.each([
    ["materials_review", "materials"],
    ["fields_pending", "fields"],
    ["logic_pending", "logic"],
    ["graph_review", "reasoning"],
    ["plan_review", "plan"],
  ] as const)("阶段 %s 正在等门 %s", (phase, gate) => {
    expect(pendingGate(phase)).toBe(gate);
  });

  it.each(["empty", "collecting", "generating", "graph_published", "backfilling"] as const)(
    "阶段 %s 不等人",
    (phase) => {
      expect(pendingGate(phase as PhaseName)).toBeNull();
    },
  );

  it("契约点名的三道硬门都真的是门（在门表里有前置阶段）", () => {
    for (const hard of C.HARD_GATES) {
      const found = C.RESEARCH_PHASES.some((p) => pendingGate(p) === hard);
      expect(found, `硬门 ${hard} 没有任何阶段在等它`).toBe(true);
    }
  });
});
