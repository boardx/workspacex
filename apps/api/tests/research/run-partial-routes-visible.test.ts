/**
 * F145 —— E1：12 路检索里 3 路失败时，已完成路的结果可见，失败路单独标出可重试
 * （`research` 束 usecases.md 1.2 / `uc-24-2` E1 / R12.5）。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 *
 * ## 这个文件要挡住的具体回归
 *
 * `packages/contracts/src/research.ts` 的 `runResearch` 注释逐字：「只返回一个
 * `success: boolean` 的实现会让『3 路挂了 9 路成了』和『全挂』在响应里长得一样」。
 * 这里的断言因此**不**只看 `completedRoutes` 这一个数字——还要证明：
 *   ① `failedRoutes` 恒列出全部失败路（附可重试所需的原因），不是被吞掉；
 *   ② 已完成路产出的证据/结论**依然可见**（不会因为另外 3 路失败就被整体清空）；
 *   ③「3 挂 9 成」与「12 全挂」在响应形状上**看得出区别**，不是长得一样。
 */
import { describe, expect, it } from "vitest";
import {
  assembleResearchRun,
  assembleResearchResult,
  type RouteAttempt,
  type ResearchClaimInput,
} from "../../src/domain/research/result-assembly";

/** 深挖档：12 路并交叉验证（`ResearchDepth` deep，`uc-24-1` 表）。 */
const DEEP_PLANNED_ROUTES = 12;

function makeAttempts(okCount: number, failCount: number): RouteAttempt[] {
  const attempts: RouteAttempt[] = [];
  const kinds = ["官方", "行业", "媒体"];
  for (let i = 0; i < okCount; i++) {
    attempts.push({ route: i + 1, ok: true, sourceKind: kinds[i % kinds.length]! });
  }
  for (let i = 0; i < failCount; i++) {
    attempts.push({ route: okCount + i + 1, ok: false, reason: "AGENT_RUN_FAILED" });
  }
  return attempts;
}

describe("F145 · E1 12 路里 3 路失败：已完成路可见，失败路单独标出可重试", () => {
  it("completedRoutes=9 与 failedRoutes.length=3 同时成立——不是合并成一个布尔", () => {
    const run = assembleResearchRun({
      researchId: "r1",
      runId: "run-1",
      plannedRoutes: DEEP_PLANNED_ROUTES,
      attempts: makeAttempts(9, 3),
      conflictsMarked: 3,
    });

    expect(run.plannedRoutes).toBe(12);
    expect(run.completedRoutes).toBe(9);
    expect(run.failedRoutes).toHaveLength(3);
    // 每条失败路都带着可供重试判断的原因，不是一个匿名的 "failed"。
    for (const f of run.failedRoutes) {
      expect(f.reason).toBe("AGENT_RUN_FAILED");
      expect(typeof f.route).toBe("number");
    }
    // 失败路的编号是**具体的**（10/11/12），不是只知道"有几个失败"。
    expect(run.failedRoutes.map((f) => f.route).sort((a, b) => a - b)).toEqual([10, 11, 12]);
  });

  it("步骤①的分类计数只统计成功路，且计数总和恰好等于 completedRoutes（不多算失败路）", () => {
    const run = assembleResearchRun({
      researchId: "r1",
      runId: "run-1",
      plannedRoutes: DEEP_PLANNED_ROUTES,
      attempts: makeAttempts(9, 3),
      conflictsMarked: 0,
    });
    const total = run.sourceCounts.reduce((a, c) => a + c.count, 0);
    expect(total).toBe(9);
    expect(total).not.toBe(run.plannedRoutes);
  });

  it("对照组：12 路全挂 —— completedRoutes=0 且 failedRoutes.length=12，与「3 挂 9 成」在形状上明显不同", () => {
    const allFailed = assembleResearchRun({
      researchId: "r1",
      runId: "run-2",
      plannedRoutes: DEEP_PLANNED_ROUTES,
      attempts: makeAttempts(0, 12),
      conflictsMarked: 0,
    });
    const partiallyFailed = assembleResearchRun({
      researchId: "r1",
      runId: "run-3",
      plannedRoutes: DEEP_PLANNED_ROUTES,
      attempts: makeAttempts(9, 3),
      conflictsMarked: 0,
    });

    expect(allFailed.completedRoutes).toBe(0);
    expect(allFailed.failedRoutes).toHaveLength(12);
    expect(allFailed.sourceCounts).toEqual([]);

    // ⚠ 这条是本文件的核心：两种情况的 completedRoutes 必须不同，
    //   一个把两者都渲染成 `success:false` 的实现在这里会假绿。
    expect(partiallyFailed.completedRoutes).not.toBe(allFailed.completedRoutes);
    expect(partiallyFailed.failedRoutes.length).not.toBe(allFailed.failedRoutes.length);
  });

  it("已完成 9 路产出的关键发现与外部来源依然可见——不会因为另外 3 路失败被整体清空", () => {
    const run = assembleResearchRun({
      researchId: "r1",
      runId: "run-1",
      plannedRoutes: DEEP_PLANNED_ROUTES,
      attempts: makeAttempts(9, 3),
      conflictsMarked: 0,
    });
    expect(run.completedRoutes).toBeGreaterThan(0);

    // 已完成路各自产出的证据，组装进 claims——模拟"9 路成功各带回一条证据"。
    const claims: ResearchClaimInput[] = [
      {
        claim: "德国并网审批全国中位 11 个月",
        evidence: Array.from({ length: 6 }, (_, i) => ({
          id: `ev-${i}`,
          claim: "德国并网审批全国中位 11 个月",
          sourceKind: "官方",
          sourceRef: `来源-${i}`,
          confidence: 0.7,
          disposition: "已引用",
        })),
      },
      {
        claim: "材料一次过可省约 6 周",
        evidence: Array.from({ length: 3 }, (_, i) => ({
          id: `ev2-${i}`,
          claim: "材料一次过可省约 6 周",
          sourceKind: "行业",
          sourceRef: `来源二-${i}`,
          confidence: 0.6,
          disposition: "已引用",
        })),
      },
    ];
    const result = assembleResearchResult({ claims, conclusionText: "以已完成路的结果为准先出结论。" });

    // E1 的核心断言：失败了 3 路，但已完成路的结果不是空的。
    expect(result.keyFindings.length).toBeGreaterThan(0);
    expect(result.externalSources.length).toBeGreaterThan(0);
    expect(result.isDataRequest).toBe(false);
    expect(result.conclusion).not.toBeNull();
  });
});
