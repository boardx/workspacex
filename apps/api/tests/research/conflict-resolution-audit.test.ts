/**
 * F148 —— 现场研究任务列表 A1/A2 + 冲突判定留痕 N-6/N-9
 * （`research` 束 domain.md N-6 / N-9，`uc-24-5` R3.2–R3.6 / A1 / A2 / R6，
 * `usecases.md` 二节 `ListLiveResearchTasks` / `ListConflicts` / `ResolveConflict` 注释）。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 *
 * ## 断言打在性质上，不是数量上（纪律第 9 条 / coding-standards E-4）
 * 「三项都不是预选/自动执行」不写成 `toHaveLength(3)`——那种断言在
 * 「删一个加一个」时全绿。本文件用 `isFullActionSet` 与
 * `assertConflictActionsNotPreselected` 断**性质**：字段不存在、集合恒等于全集。
 */
import { describe, expect, it } from "vitest";
import { research } from "@repo/contracts";
import {
  filterLiveTasks,
  computeLiveTaskCounts,
  pendingConflictCount,
  assertConflictActionsNotPreselected,
  isFullActionSet,
  resolveConflict,
  type LiveTaskRow,
  type ResearchConflictT,
  type ConflictActionT,
} from "../../src/domain/research/live-conflicts";

const FULL_ACTIONS = research.ConflictAction.options;

function task(overrides: Partial<LiveTaskRow> & Pick<LiveTaskRow, "researchId">): LiveTaskRow {
  return {
    at: "12:00",
    question: "占位问题",
    proposedBy: "引导师提出",
    status: "运行中",
    sourceCount: 0,
    conflictCount: 0,
    ...overrides,
  };
}

function conflict(overrides: Partial<ResearchConflictT> & Pick<ResearchConflictT, "id">): ResearchConflictT {
  return {
    researchId: "r1",
    statement: "占位冲突陈述",
    agentSuggestion: "建议以样本为准",
    actions: [...FULL_ACTIONS],
    resolution: null,
    ...overrides,
  };
}

describe("F148 · A1 onlyConflicts 的判据取 conflictCount > 0，不是状态词", () => {
  it("反空转：mock 数据里确实存在 conflictCount>0 但状态词不含『冲突』字样的行——没有这条，下面的断言无的放矢", () => {
    const rows = [
      task({ researchId: "a", status: "运行中", conflictCount: 0 }),
      task({ researchId: "b", status: "待判定", conflictCount: 2 }),
      task({ researchId: "c", status: "已就绪", conflictCount: 0 }),
    ];
    expect(rows.some((t) => t.conflictCount > 0 && !t.status.includes("冲突"))).toBe(true);
  });

  it("onlyConflicts=true 只留 conflictCount>0 的行，且用真实计数核对，不是写死条数", () => {
    const rows = [
      task({ researchId: "a", status: "运行中", conflictCount: 0 }),
      task({ researchId: "b", status: "待判定", conflictCount: 2 }),
      task({ researchId: "c", status: "已就绪", conflictCount: 0 }),
      task({ researchId: "d", status: "待判定", conflictCount: 1 }),
    ];
    const filtered = filterLiveTasks(rows, true);
    const expected = rows.filter((t) => t.conflictCount > 0);
    expect(filtered.map((t) => t.researchId).sort()).toEqual(expected.map((t) => t.researchId).sort());
  });

  it("onlyConflicts=false 原样返回全部行（不因为过滤参数存在就顺手丢行）", () => {
    const rows = [task({ researchId: "a" }), task({ researchId: "b", conflictCount: 3 })];
    expect(filterLiveTasks(rows, false)).toHaveLength(rows.length);
  });

  it("按『待判定』这个词过滤会漏掉/多算——用状态词过滤不是本函数的判据（反证）", () => {
    // 一行冲突数>0 但状态词恰好是『运行中』（agent 还在跑，冲突已先标出）
    const rows = [task({ researchId: "x", status: "运行中", conflictCount: 1 })];
    const byWord = rows.filter((t) => t.status === "待判定");
    const byCount = filterLiveTasks(rows, true);
    expect(byWord).toHaveLength(0);
    expect(byCount).toHaveLength(1);
  });
});

describe("F148 · 一行 agent 失败不影响其余行（独立求值）", () => {
  it("computeLiveTaskCounts 对失败行不做特殊处理，其余行的计数不受影响", () => {
    const rows = [
      task({ researchId: "a", status: "已就绪", conflictCount: 0 }),
      task({ researchId: "fail", status: "失败", conflictCount: 0 }),
      task({ researchId: "b", status: "已就绪", conflictCount: 1 }),
    ];
    const counts = computeLiveTaskCounts(rows);
    expect(counts.total).toBe(3);
    expect(counts.ready).toBe(2);
    expect(counts.conflicts).toBe(1);
  });
});

describe("F148 · A2 冲突为 0 时区块仍在，恒返回一个数", () => {
  it("反空转：一个非空冲突列表里，pendingConflictCount 与全部未判定条数一致", () => {
    const conflicts = [conflict({ id: "c1" }), conflict({ id: "c2" })];
    expect(pendingConflictCount(conflicts)).toBe(2);
  });

  it("空冲突列表：pendingConflictCount 返回 0，而不是 null/undefined（界面据此渲染空态而不是摘掉区块）", () => {
    expect(pendingConflictCount([])).toBe(0);
    expect(pendingConflictCount([])).not.toBeUndefined();
  });

  it("已判定的冲突不计入待判定数（区分『冲突存在』与『冲突待判定』）", () => {
    const resolved = resolveConflict(conflict({ id: "c1" }), {
      action: "以样本为准",
      actorUserId: "u-linke",
      resolvedAt: "2026-07-31T14:52:00Z",
    });
    expect(pendingConflictCount([resolved])).toBe(0);
  });
});

describe("F148 · N-6 三个判定动作恒为全集、不带预选/自动执行字段", () => {
  it("反空转：契约的 ConflictAction 全集恰好三项", () => {
    expect(FULL_ACTIONS).toHaveLength(3);
  });

  it("mock/构造出的冲突对象 actions 恒等于全集（性质：集合相等，不是长度相等）", () => {
    const c = conflict({ id: "c1", actions: [...FULL_ACTIONS].reverse() });
    expect(isFullActionSet(c.actions, FULL_ACTIONS)).toBe(true);
  });

  it("少一项或多一项都判为『不是全集』（isFullActionSet 不是摆设）", () => {
    expect(isFullActionSet(FULL_ACTIONS.slice(0, 2), FULL_ACTIONS)).toBe(false);
    const withDuplicate: ConflictActionT[] = [...FULL_ACTIONS, "以样本为准"];
    expect(isFullActionSet(withDuplicate, FULL_ACTIONS)).toBe(false);
  });

  it("一个合法的 ResearchConflict 对象上不存在任何预选/默认/倒计时字段（zod .strict() + 本函数双重把关）", () => {
    const c = conflict({ id: "c1" });
    expect(() => assertConflictActionsNotPreselected(c)).not.toThrow();
  });

  it("反证：手工塞入一个 suggestedAction 字段，assertConflictActionsNotPreselected 必须报警", () => {
    const tampered = { ...conflict({ id: "c1" }), suggestedAction: "以样本为准" } as ResearchConflictT;
    expect(() => assertConflictActionsNotPreselected(tampered)).toThrow(/N-6/);
  });

  it("反证：手工塞入 countdownSeconds，同样必须报警", () => {
    const tampered = { ...conflict({ id: "c1" }), countdownSeconds: 10 } as ResearchConflictT;
    expect(() => assertConflictActionsNotPreselected(tampered)).toThrow(/N-6/);
  });
});

describe("F148 · N-9/R6 判定后可读到『谁在何时选了哪一条』，且不可静默覆盖", () => {
  it("resolveConflict 记录 actorUserId / resolvedAt / action 三件，且 statement 等原字段不变", () => {
    const before = conflict({ id: "c1", statement: "行业报告说平均 7 个月，项目样本中位 9.5 个月。" });
    const after = resolveConflict(before, {
      action: "以样本为准",
      actorUserId: "u-linke",
      resolvedAt: "2026-07-31T14:52:00Z",
    });
    expect(after.resolution).not.toBeNull();
    expect(after.resolution?.action).toBe("以样本为准");
    expect(after.resolution?.actorUserId).toBe("u-linke");
    expect(after.resolution?.resolvedAt).toBe("2026-07-31T14:52:00Z");
    expect(after.statement).toBe(before.statement);
    expect(after.id).toBe(before.id);
  });

  it("判定前 resolution 为 null（待判定），判定后不再是 null——这条转变是单向的", () => {
    const before = conflict({ id: "c1" });
    expect(before.resolution).toBeNull();
    const after = resolveConflict(before, { action: "上台讨论", actorUserId: "u-x", resolvedAt: "t" });
    expect(after.resolution).not.toBeNull();
  });

  it("对已判定的冲突再次调用 resolveConflict 必须拒绝，不允许静默覆盖第一次的留痕", () => {
    const resolved = resolveConflict(conflict({ id: "c1" }), {
      action: "以样本为准",
      actorUserId: "u-first",
      resolvedAt: "t1",
    });
    expect(() =>
      resolveConflict(resolved, { action: "上台讨论", actorUserId: "u-second", resolvedAt: "t2" }),
    ).toThrow();
    // 反证：拒绝之后，第一次的留痕必须原样还在（不是被清空成 null 之类的半失败态）
    expect(resolved.resolution?.actorUserId).toBe("u-first");
  });

  it("resolveConflict 不修改入参对象本身（不可变：调用方原对象保持待判定）", () => {
    const before = conflict({ id: "c1" });
    resolveConflict(before, { action: "再补一路检索", actorUserId: "u-y", resolvedAt: "t" });
    expect(before.resolution).toBeNull();
  });
});
