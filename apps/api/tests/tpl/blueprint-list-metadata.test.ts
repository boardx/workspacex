import { describe, expect, it } from "vitest";
import { templates } from "@repo/contracts";
import { DESIGN_FACET_DEFINITIONS, designFacetKeys } from "../../src/domain/templates/design-facet-table";
import {
  deriveBlueprintRow,
  deriveBlueprintRowActions,
  deriveSatisfaction,
} from "../../src/domain/templates/blueprint-list-row";
import type { BlueprintVersion } from "../../src/domain/templates/blueprint-version";

/**
 * F30 —— 蓝本列表行元数据（D-03 / AC4，`uc-2-4` R3 步骤 5 · R12 V4）。
 *
 * V4 逐字：「构造一份『已发布 v3 · 9 环节·1d · 用过 6 次 · 满意度 4.5 · 15/16』的蓝本，
 * 断言列表行六个字段各就各位；特别断言 9（议程环节数）与 15/16（设计配置完成度）
 * 在接口与 UI 上是两个独立字段。」
 */

const publishedV3: BlueprintVersion = {
  id: "ver-3",
  blueprintId: "bp-a",
  versionNumber: 3,
  content: {},
  changedDesignFacetKeys: [],
  rolledBackFrom: null,
  state: "published",
};

describe("V4：议程环节数与设计配置完成度是两个独立字段（D-03，不得串位）", () => {
  it("9 环节 · 15/16(取自表长) 分别落在各自字段，互不影响", () => {
    // 用全表除去最后一项作为「已完成」，验证 completeness 与 agendaSegmentCount 数值不同但互不干扰
    const completedKeys = designFacetKeys().slice(0, -1);
    const row = deriveBlueprintRow({
      blueprintId: "bp-a",
      name: "HMW 定题项目",
      state: "published",
      currentVersion: publishedV3,
      agendaSegmentCount: 9,
      appliedProjectCount: 6,
      referencingProjectCount: 6,
      reviewScores: [4, 5, 4, 5, 4],
      minSatisfactionSampleSize: 3,
      completedDesignFacetKeys: completedKeys,
    });

    expect(row.agendaSegmentCount).toBe(9);
    expect(row.completeness.denominator).toBe(DESIGN_FACET_DEFINITIONS.length);
    expect(row.completeness.done).toBe(completedKeys.length);
    // 两个数字互不相等（除非表长恰好也是 9，用不等式断言意图而非具体值）
    expect(row.agendaSegmentCount).not.toBe(row.completeness.denominator);
    expect(row.versionNumber).toBe(3);
    expect(row.appliedProjectCount).toBe(6);
  });

  it("分母恒等于定义表长度——传入一张自定义表也照样跟着变（不是写死的字面量）", () => {
    const customTable = [...DESIGN_FACET_DEFINITIONS, { ...DESIGN_FACET_DEFINITIONS[0]!, designFacetKey: "extra-slot" }];
    const row = deriveBlueprintRow({
      blueprintId: "bp-a",
      name: "x",
      state: "published",
      currentVersion: publishedV3,
      agendaSegmentCount: 1,
      appliedProjectCount: 0,
      referencingProjectCount: 0,
      reviewScores: [],
      minSatisfactionSampleSize: 3,
      completedDesignFacetKeys: [],
      designFacetTable: customTable,
    });
    expect(row.completeness.denominator).toBe(customTable.length);
    expect(row.completeness.denominator).toBe(DESIGN_FACET_DEFINITIONS.length + 1);
  });
});

describe("草稿态不显示版本号（uc-2-4 R7）", () => {
  it("state=draft ⇒ versionNumber 为 null，即使传了 currentVersion", () => {
    const row = deriveBlueprintRow({
      blueprintId: "bp-draft",
      name: "草稿蓝本",
      state: "draft",
      currentVersion: publishedV3,
      agendaSegmentCount: 4,
      appliedProjectCount: 0,
      referencingProjectCount: 0,
      reviewScores: [],
      minSatisfactionSampleSize: 3,
      completedDesignFacetKeys: [],
    });
    expect(row.versionNumber).toBeNull();
  });
});

describe("O-37 ③：满意度低于最小样本量显示样本不足（null），达标则给均值", () => {
  it("样本量不足 ⇒ null，且样本量本身仍可读", () => {
    const result = deriveSatisfaction([5, 4], 3);
    expect(result.satisfaction).toBeNull();
    expect(result.sampleSize).toBe(2);
  });

  it("样本量达标 ⇒ 均值", () => {
    const result = deriveSatisfaction([4, 5, 3, 5], 3);
    expect(result.satisfaction).toBeCloseTo(4.25);
    expect(result.sampleSize).toBe(4);
  });

  it("阈值是参数，不是写死的数字——同一批分数换阈值就换结果", () => {
    const scores = [4, 4, 4];
    expect(deriveSatisfaction(scores, 3).satisfaction).not.toBeNull();
    expect(deriveSatisfaction(scores, 4).satisfaction).toBeNull();
  });
});

describe("I-8：行操作由引用计数派生，[× 删除] 与 [归档] 互斥", () => {
  it("未被套用过 ⇒ delete 可用，archive 不可用", () => {
    const actions = deriveBlueprintRowActions({
      state: "published",
      referencingProjectCount: 0,
      hasPublishedVersion: true,
    });
    expect(actions).toContain("delete");
    expect(actions).not.toContain("archive");
  });

  it("已被套用过 ⇒ archive 可用，delete 不可用", () => {
    const actions = deriveBlueprintRowActions({
      state: "published",
      referencingProjectCount: 3,
      hasPublishedVersion: true,
    });
    expect(actions).toContain("archive");
    expect(actions).not.toContain("delete");
  });

  it("copy 恒可用；rollback 只在有过发布历史时出现", () => {
    const noHistory = deriveBlueprintRowActions({
      state: "draft",
      referencingProjectCount: 0,
      hasPublishedVersion: false,
    });
    expect(noHistory).toContain("copy");
    expect(noHistory).not.toContain("rollback");

    const withHistory = deriveBlueprintRowActions({
      state: "published",
      referencingProjectCount: 0,
      hasPublishedVersion: true,
    });
    expect(withHistory).toContain("copy");
    expect(withHistory).toContain("rollback");
  });
});

describe("契约对齐：BlueprintRow 与 availableActions 枚举与本文件同形", () => {
  it("行操作值域恒等于契约声明的四个", () => {
    const enumValues = templates.BlueprintRow.shape.availableActions.element.options;
    expect(new Set(enumValues)).toEqual(new Set(["archive", "delete", "copy", "rollback"]));
  });
});
