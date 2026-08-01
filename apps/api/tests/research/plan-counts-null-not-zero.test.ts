/**
 * F146 —— N-8：研究计划三计数「目标缺失」渲染为 `null`（界面据此渲染 `—`），
 * 绝不能被算成 `0`（`research` 束 domain.md N-8，`uc-24-3` R3.D / R12.3）。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 *
 * ## 断言打在「能否区分」上，不是任意一侧的固定数字（纪律第 9 条 / coding-standards E-4）
 *
 * `null` 和 `0` 都是合法值，都要能被正确产出——本文件因此**同时**造「缺失」与
 * 「显式为 0」两种输入，证明两者在输出里长得不一样，而不是随便挑一种断言存在。
 */
import { describe, expect, it } from "vitest";
import { derivePlanCounts, isCountMissing, type PlanCountsInput } from "../../src/domain/research/plan-counts";

function baseInput(overrides: Partial<PlanCountsInput> = {}): PlanCountsInput {
  return {
    questions: ["q1", "q2", "q3", "q4", "q5"],
    evidence: Array.from({ length: 41 }, (_, i) => ({ id: `e${i}` })),
    evidenceTarget: 50,
    candidateInsights: ["ci1", "ci2", "ci3", "ci4", "ci5", "ci6", "ci7"],
    ...overrides,
  };
}

describe("F146 · N-8 目标缺失 ⇒ null，不是 0", () => {
  it("evidenceTarget 未设（null）时，输出仍是 null——不被 ?? 0 之类的写法转掉", () => {
    const counts = derivePlanCounts(baseInput({ evidenceTarget: null }));
    expect(counts.evidenceTarget).toBeNull();
    // Object.is 而不是 == ，确保不是 0 也不是 undefined 之类的近似值
    expect(Object.is(counts.evidenceTarget, 0)).toBe(false);
  });

  it("evidenceTarget 显式设为 0 时，输出就是 0——不能被误判成缺失", () => {
    const counts = derivePlanCounts(baseInput({ evidenceTarget: 0 }));
    expect(counts.evidenceTarget).toBe(0);
    expect(isCountMissing(counts.evidenceTarget)).toBe(false);
  });

  it("正常设了目标（50）时原样透传，分子（evidenceCount）跟着证据数组走，不是写死的", () => {
    const counts = derivePlanCounts(baseInput());
    expect(counts.evidenceTarget).toBe(50);
    expect(counts.evidenceCount).toBe(41);

    const withMoreEvidence = derivePlanCounts(
      baseInput({ evidence: Array.from({ length: 42 }, (_, i) => ({ id: `e${i}` })) }),
    );
    // 反空转：分子确实跟着数据变了，不是凑巧算出同一个数。
    expect(withMoreEvidence.evidenceCount).not.toBe(counts.evidenceCount);
    expect(withMoreEvidence.evidenceCount).toBe(42);
  });

  it("undefined 防御：即便上游传了 undefined，也当作缺失处理，不当成 0", () => {
    const counts = derivePlanCounts(baseInput({ evidenceTarget: undefined as unknown as null }));
    expect(counts.evidenceTarget).toBeNull();
  });
});

describe("F146 · Q-8 questionCount：null（无此子实体）与 0（有但为空）不是同一件事", () => {
  it("questions 为 null（一层模型，没有子实体这个概念）⇒ questionCount 为 null", () => {
    const counts = derivePlanCounts(baseInput({ questions: null }));
    expect(counts.questionCount).toBeNull();
  });

  it("questions 为空数组（两层模型，子实体存在但目前 0 条）⇒ questionCount 为 0，不是 null", () => {
    const counts = derivePlanCounts(baseInput({ questions: [] }));
    expect(counts.questionCount).toBe(0);
    expect(counts.questionCount).not.toBeNull();
  });

  it("questions 有 5 条 ⇒ questionCount 为 5", () => {
    const counts = derivePlanCounts(baseInput());
    expect(counts.questionCount).toBe(5);
  });
});

describe("F146 · candidateInsightCount 同族：null 与 0 同样必须可区分", () => {
  it("candidateInsights 为 null ⇒ candidateInsightCount 为 null", () => {
    const counts = derivePlanCounts(baseInput({ candidateInsights: null }));
    expect(counts.candidateInsightCount).toBeNull();
  });

  it("candidateInsights 为空数组 ⇒ candidateInsightCount 为 0", () => {
    const counts = derivePlanCounts(baseInput({ candidateInsights: [] }));
    expect(counts.candidateInsightCount).toBe(0);
  });
});

describe("F146 · isCountMissing：0 是合法值，不能被判成缺失", () => {
  it("0 不缺失，null/undefined 缺失", () => {
    expect(isCountMissing(0)).toBe(false);
    expect(isCountMissing(null)).toBe(true);
    expect(isCountMissing(undefined)).toBe(true);
  });

  it("三计数 + 目标同时缺失（一场刚创建、Scout 还没跑过的研究）⇒ 全部 null，界面据此全渲染 —", () => {
    const counts = derivePlanCounts({ questions: null, evidence: [], evidenceTarget: null, candidateInsights: null });
    expect(counts.questionCount).toBeNull();
    expect(counts.evidenceTarget).toBeNull();
    expect(counts.candidateInsightCount).toBeNull();
    // evidenceCount 恒为 number（证据表本身恒存在，即便 0 行）
    expect(counts.evidenceCount).toBe(0);
    expect(isCountMissing(counts.questionCount)).toBe(true);
    expect(isCountMissing(counts.evidenceTarget)).toBe(true);
    expect(isCountMissing(counts.candidateInsightCount)).toBe(true);
  });
});
