import { describe, expect, it } from "vitest";
import { templates } from "@repo/contracts";
import {
  planSixCategoryInit,
  SIX_CATEGORIES,
} from "../../src/domain/templates/apply-blueprint-init";
import { planInitializationPreview } from "../../src/domain/templates/initialization-preview";
import {
  agendaSegmentCountForTier,
  type OrderedDurationTier,
} from "../../src/domain/templates/agenda-segment-table";
import { DESIGN_FACET_DEFINITIONS } from "../../src/domain/templates/design-facet-table";

/**
 * F23 —— 六类初始化事务写入的**计划**（`uc-2-2` R3 AC1/AC2，与 `applyBlueprint.out.initialized`
 * 同形状）。
 *
 * ⚠ 「计划」与「实际落库」是两件事：本文件只断言 `planSixCategoryInit` 这个纯函数，
 * 不断言事务/幂等（那是 `apply-transactional-idempotent.test.ts` 的范围）。
 *
 * ⚠ 本文件**不点名任何具体的设计配置项 key**（同 `required-column-drives-gate.test.ts`
 * 的纪律，且是 `lint-design-facet-single-source.mjs` 规则 2b 的硬要求）：facet key 一律
 * 从 `DESIGN_FACET_DEFINITIONS` 按结构（`initCategory` 是否为 null / 是否等于某一类）
 * 筛出来，不手写字面量——手写三个以上不同 key 就是第二份槽位清单的样子。
 */

/** 该类映射到的第一个 facet key（不点名，按结构筛）。类不存在时返回 null。 */
function firstFacetKeyForCategory(category: string): string | null {
  return DESIGN_FACET_DEFINITIONS.find((r) => r.initCategory === category)?.designFacetKey ?? null;
}

/** initCategory 为 null 的那一个（今天恒是「定题是继承的种子」那一项，不点名）。 */
function firstUnmappedFacetKey(): string {
  return DESIGN_FACET_DEFINITIONS.find((r) => r.initCategory === null)!.designFacetKey;
}

/** 五类（除议程环节外）各取一个 facet key，用于同时喂给 preview 与 plan。 */
function oneFacetKeyPerNonAgendaCategory(): string[] {
  return SIX_CATEGORIES.filter((c) => c !== "议程环节")
    .map((c) => firstFacetKeyForCategory(c))
    .filter((k): k is string => k !== null);
}

describe("六类恒存在，顺序与取值来自契约本身（I-17）", () => {
  it("SIX_CATEGORIES 与契约 InitializationCategory 逐项相等", () => {
    expect(SIX_CATEGORIES).toEqual(templates.InitializationCategory.options);
  });

  it("无论 filledFacetKeys 是否为空，六类都出现在 initialized 里", () => {
    const plan = planSixCategoryInit([], "half-day");
    expect(plan.initialized.map((c) => c.category)).toEqual(SIX_CATEGORIES);
  });
});

describe("「议程环节」这一类的数量 = 所选档位（AC1），与是否填了流程配置项无关", () => {
  const tiers: OrderedDurationTier[] = ["half-day", "one-day", "two-day", "three-day"];

  it.each(tiers)("档位 %s：即使一个设计配置项都没填，议程环节数仍等于该档位的真实议程环节数", (tier) => {
    const plan = planSixCategoryInit([], tier);
    const agendaCount = plan.initialized.find((c) => c.category === "议程环节")!.count;
    expect(agendaCount).toBe(agendaSegmentCountForTier(tier));
    expect(plan.agendaSegments.length).toBe(agendaSegmentCountForTier(tier));
  });

  it("填了映射到「议程环节」的那个设计配置项，也不会让数量变成「一览的条目数」（1），而是仍按档位走", () => {
    const agendaFacetKey = firstFacetKeyForCategory("议程环节");
    expect(agendaFacetKey, "定义表里应至少有一项映射到「议程环节」，否则本测试断言的是空集").not.toBeNull();

    const plan = planSixCategoryInit([agendaFacetKey!], "three-day");
    const agendaCount = plan.initialized.find((c) => c.category === "议程环节")!.count;
    expect(agendaCount).toBe(agendaSegmentCountForTier("three-day"));
    expect(agendaCount).not.toBe(1);
  });

  it("custom 档位下议程环节数与具体行数恒为 0（推导规则未定，宁可拒绝也不猜，同 duration-tier.ts）", () => {
    const agendaFacetKey = firstFacetKeyForCategory("议程环节")!;
    const plan = planSixCategoryInit([agendaFacetKey], "custom");
    const agendaCount = plan.initialized.find((c) => c.category === "议程环节")!.count;
    expect(agendaCount).toBe(0);
    expect(plan.agendaSegments).toEqual([]);
  });

  it("升档随之增加议程环节数（半天 < 一天 < 两天 < 三天）", () => {
    const counts = tiers.map(
      (tier) => planSixCategoryInit([], tier).initialized.find((c) => c.category === "议程环节")!.count,
    );
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(new Set(counts).size).toBe(4); // 四档互不相同
  });
});

describe("其余五类的数量 = 一览（getInitializationPreview 同款 planner）里该类的条目数（AC2 逐项对得上）", () => {
  it("空 filledFacetKeys ⇒ 除议程环节外，其余五类恒为 0", () => {
    const plan = planSixCategoryInit([], "two-day");
    for (const c of plan.initialized) {
      if (c.category !== "议程环节") expect(c.count).toBe(0);
    }
  });

  it("每类的 count 与 planInitializationPreview 给出的该类条目数逐项相等", () => {
    const filled = oneFacetKeyPerNonAgendaCategory();
    expect(filled.length).toBeGreaterThan(0);
    const preview = planInitializationPreview(filled);
    const plan = planSixCategoryInit(filled, "two-day");

    for (const category of SIX_CATEGORIES) {
      if (category === "议程环节") continue; // 议程环节独立于一览，见上一 describe
      const expected = preview.items.filter((i) => i.category === category).length;
      const actual = plan.initialized.find((c) => c.category === category)!.count;
      expect(actual, `类别「${category}」的写入条数应等于一览条目数`).toBe(expected);
    }
  });

  it("previewItems 就是同一次 planInitializationPreview 调用的结果，不是本文件另开一份判断", () => {
    const filled = oneFacetKeyPerNonAgendaCategory();
    const preview = planInitializationPreview(filled);
    const plan = planSixCategoryInit(filled, "half-day");
    expect(plan.previewItems).toEqual(preview.items);
  });

  it("initCategory 为 null 的那一项恒不进任何一类（定题是继承的种子，不是六类之一）", () => {
    const unmapped = firstUnmappedFacetKey();
    const plan = planSixCategoryInit([unmapped], "half-day");
    const nonAgendaTotal = plan.initialized
      .filter((c) => c.category !== "议程环节")
      .reduce((sum, c) => sum + c.count, 0);
    expect(nonAgendaTotal).toBe(0);
  });
});
