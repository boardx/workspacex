/**
 * F68 · 聚合改进建议的结构性判据 + 归类分流（UC-3.6 R3 阶段二，O-35；V2/V6/AC4）。
 *
 * V2（聚合态）：同一 skill 上多条同类 👎 聚合成一条带计数与建议文案的条目；
 *   `thumbsDownCount` 与 `caseCount` 口径分别标注（原型 👎9 / 12 个原始案例反证）。
 * O-35：聚合键是结构性判据 `(skillId, skillVersionId, agentId, issueLabel)`，
 *   **不是相似度打分**——任一字段不同即为不同建议。
 * V6/AC4：归类为 `实现层缺陷` 的条目不出现 `[生成 skill 改进 PR]`，只提供分流出口。
 */
import { describe, expect, it } from "vitest";
import {
  aggregateSuggestions,
  canGenerateProposal,
  routeFor,
  structuralKeyOf,
  type ThumbsDownCase,
} from "../../../src/domain/skill/suggestion-aggregation";
import { classifySuggestion } from "../../../src/application/skill/classify-suggestion";
import { suggestionCategoryStore } from "../../support/skill-fakes";

const BASE: Omit<ThumbsDownCase, "caseId" | "raterId" | "isThumbsDown"> = {
  skillId: "sk-facilitator",
  skillVersionId: "v3",
  agentId: "agent-fc",
  issueLabel: "打断时机过早",
};

function facilitatorCase(over: Partial<ThumbsDownCase> & { caseId: string }): ThumbsDownCase {
  return {
    ...BASE,
    raterId: `rater-${over.caseId}`,
    isThumbsDown: true,
    ...over,
  };
}

describe("V2：结构键相同的案例聚合成一条，thumbsDownCount 与 caseCount 分别标注", () => {
  it("原型反证：👎9 但 12 个原始案例——两个数字不相等也不混用", () => {
    const cases: ThumbsDownCase[] = [
      ...Array.from({ length: 9 }, (_, i) => facilitatorCase({ caseId: `down-${i}`, isThumbsDown: true })),
      ...Array.from({ length: 3 }, (_, i) =>
        facilitatorCase({ caseId: `similar-${i}`, isThumbsDown: false }),
      ),
    ];

    const [suggestion] = aggregateSuggestions(cases);

    expect(suggestion).toBeDefined();
    expect(suggestion!.thumbsDownCount).toBe(9);
    expect(suggestion!.caseCount).toBe(12);
    expect(suggestion!.caseIds).toHaveLength(12);
    expect(suggestion!.machineGenerated).toBe(true);
  });
});

describe("O-35：聚合键是结构性判据，不是相似度打分——任一字段不同即为不同建议", () => {
  it("不同 skillVersionId ⇒ 两条独立建议，不合并", () => {
    const cases: ThumbsDownCase[] = [
      facilitatorCase({ caseId: "a" }),
      facilitatorCase({ caseId: "b", skillVersionId: "v4" }),
    ];
    const suggestions = aggregateSuggestions(cases);
    expect(suggestions).toHaveLength(2);
  });

  it("不同 agentId ⇒ 两条独立建议", () => {
    const cases: ThumbsDownCase[] = [
      facilitatorCase({ caseId: "a" }),
      facilitatorCase({ caseId: "b", agentId: "agent-scout" }),
    ];
    expect(aggregateSuggestions(cases)).toHaveLength(2);
  });

  it("不同 issueLabel（人工归类标签）⇒ 两条独立建议，即便文字看起来相近", () => {
    const cases: ThumbsDownCase[] = [
      facilitatorCase({ caseId: "a", issueLabel: "打断时机过早" }),
      facilitatorCase({ caseId: "b", issueLabel: "打断时机偏早" }),
    ];
    expect(aggregateSuggestions(cases)).toHaveLength(2);
  });

  it("四个维度全相等 ⇒ 无论案例数多少都只有一条建议", () => {
    const cases: ThumbsDownCase[] = Array.from({ length: 20 }, (_, i) =>
      facilitatorCase({ caseId: `c-${i}` }),
    );
    expect(aggregateSuggestions(cases)).toHaveLength(1);
  });

  it("structuralKeyOf 是聚合键的可断言形状：四个字段拼接，不含任何打分数值", () => {
    const key = structuralKeyOf(BASE);
    expect(key).toBe("sk-facilitator::v3::agent-fc::打断时机过早");
  });
});

describe("V6/AC4：归类决定 [生成 skill 改进 PR] 按钮与分流出口", () => {
  it("contract-solvable ⇒ 可生成提案，路由到 skill-improvement", () => {
    expect(canGenerateProposal("contract-solvable")).toBe(true);
    expect(routeFor("contract-solvable")).toBe("skill-improvement");
  });

  it("implementation-defect ⇒ 不出现生成按钮，只路由到软件反馈通道（A1）", () => {
    expect(canGenerateProposal("implementation-defect")).toBe(false);
    expect(routeFor("implementation-defect")).toBe("software-feedback");
  });

  it("model-limited ⇒ 不出现生成按钮，路由到换模型入口（A2）", () => {
    expect(canGenerateProposal("model-limited")).toBe(false);
    expect(routeFor("model-limited")).toBe("model-swap");
  });

  it("尚未归类（null）⇒ 同样不给生成按钮", () => {
    expect(canGenerateProposal(null)).toBe(false);
    expect(routeFor(null)).toBe("unclassified");
  });

  it("classifySuggestion 落库归类后，聚合投影据此重算路由与按钮可见性", async () => {
    const store = suggestionCategoryStore();
    const key = structuralKeyOf(BASE);

    const result = await classifySuggestion({ structuralKey: key, category: "implementation-defect" }, { store });

    expect(result.canGenerateProposal).toBe(false);
    expect(result.route).toBe("software-feedback");
    expect(await store.categoryOf(key)).toBe("implementation-defect");

    const cases: ThumbsDownCase[] = [facilitatorCase({ caseId: "a" })];
    const [suggestion] = aggregateSuggestions(cases, { [key]: "implementation-defect" });
    expect(suggestion!.category).toBe("implementation-defect");
    expect(canGenerateProposal(suggestion!.category)).toBe(false);
  });
});
