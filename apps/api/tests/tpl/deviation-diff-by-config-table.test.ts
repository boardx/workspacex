import { describe, expect, it } from "vitest";
import { computeDeviations, stringifyFacetValue } from "../../src/domain/templates/deviation-diff";
import { DESIGN_FACET_DEFINITIONS, type DesignFacetRow } from "../../src/domain/templates/design-facet-table";
import {
  computeDeviationsUseCase,
  ComputeDeviationsError,
} from "../../src/application/templates/compute-deviations";
import type { ComputeDeviationsRepository } from "../../src/application/templates/compute-deviations-ports";
import { toOrgId } from "../../src/domain/org-id";

/**
 * F29 —— **偏离 diff 按配置项定义表逐项遍历**（`uc-2-3` R3 步骤 1 / D-03 术语三分）。
 *
 * 三条性质：
 *   ① diff **遍历传入的表**，不硬编码 16/15——一张任意大小的自定义表也能正确工作。
 *   ② 恰好列出真正变了的那几条，未改动项不出现（V2）。
 *   ③ 议程环节的变化落在 `flow-agenda` 这一项名下，没有特殊代码路径。
 */

describe("① 按配置项定义表遍历，不硬编码项数", () => {
  const tinyTable: readonly DesignFacetRow[] = [
    { designFacetKey: "a", label: "A", group: "basic", ordinal: 1, required: false },
    { designFacetKey: "b", label: "B", group: "basic", ordinal: 2, required: false },
    { designFacetKey: "c", label: "C", group: "output", ordinal: 1, required: false },
  ];

  it("表只有 3 行时最多只能产出 3 条偏离，即便 content 里塞了表外的键", () => {
    const base = { a: "1", b: "2", c: "3", extraneous: "not in table" };
    const current = { a: "1-changed", b: "2", c: "3", extraneous: "also changed but not in table" };
    const deviations = computeDeviations(base, current, tinyTable);
    expect(deviations).toEqual([{ designFacetKey: "a", beforeValue: "1", afterValue: "1-changed" }]);
  });

  it("用真实的表时，遍历的行数就是表本身的长度，不是任何字面量", () => {
    const base: Record<string, unknown> = {};
    const current: Record<string, unknown> = {};
    for (const row of DESIGN_FACET_DEFINITIONS) base[row.designFacetKey] = "same";
    for (const row of DESIGN_FACET_DEFINITIONS) current[row.designFacetKey] = "same";
    expect(computeDeviations(base, current)).toEqual([]);
    // 改表长度不需要改这份测试或实现——遍历的是表本身
    expect(DESIGN_FACET_DEFINITIONS.length).toBeGreaterThan(0);
  });
});

describe("② 恰好列出改动的那几条，未改动项不出现（V2）", () => {
  it("任取表中 3 行改动，断言偏离清单恰好列出这 3 条，且各带蓝本原值→本场实际值", () => {
    // ⚠ 刻意不写死具体是哪 3 个 designFacetKey——本测试关心的是"改了几个就列几个"
    // 这条性质本身，不关心表里恰好叫什么名字（那是 design-facet-table.ts 唯一的事）。
    const changedRows = DESIGN_FACET_DEFINITIONS.slice(0, 3);
    const base: Record<string, unknown> = {};
    const current: Record<string, unknown> = {};
    for (const row of DESIGN_FACET_DEFINITIONS) {
      base[row.designFacetKey] = `base-${row.designFacetKey}`;
      current[row.designFacetKey] = `base-${row.designFacetKey}`;
    }
    for (const row of changedRows) {
      current[row.designFacetKey] = `changed-${row.designFacetKey}`;
    }

    const deviations = computeDeviations(base, current);

    expect(deviations).toHaveLength(changedRows.length);
    expect(deviations).toEqual(
      changedRows.map((row) => ({
        designFacetKey: row.designFacetKey,
        beforeValue: `base-${row.designFacetKey}`,
        afterValue: `changed-${row.designFacetKey}`,
      })),
    );
  });

  it("完全照蓝本跑（无改动）时偏离清单是真实空数组（A3）", () => {
    const content: Record<string, unknown> = {};
    for (const row of DESIGN_FACET_DEFINITIONS) content[row.designFacetKey] = "unchanged";
    expect(computeDeviations(content, content)).toEqual([]);
  });
});

describe("③ 议程环节的增删改归到「流程 Agenda」（flow-agenda）名下，无特殊代码路径", () => {
  it("flow-agenda 的值从一份议程数组变成另一份，走的是同一条通用比较逻辑", () => {
    const base = { "flow-agenda": JSON.stringify(["A", "B", "C"]) };
    const current = { "flow-agenda": JSON.stringify(["A", "B", "C", "D"]) };
    const deviations = computeDeviations(base, current);
    expect(deviations).toEqual([
      {
        designFacetKey: "flow-agenda",
        beforeValue: JSON.stringify(["A", "B", "C"]),
        afterValue: JSON.stringify(["A", "B", "C", "D"]),
      },
    ]);
  });

  it("stringifyFacetValue：缺失键归一到空字符串，不是字面量 undefined", () => {
    expect(stringifyFacetValue(undefined)).toBe("");
    expect(stringifyFacetValue(null)).toBe("");
    expect(stringifyFacetValue("literal")).toBe("literal");
    expect(stringifyFacetValue({ a: 1 })).toBe(JSON.stringify({ a: 1 }));
  });
});

describe("④ 应用层：谁能看、依赖失败、真实空态 NO_DEVIATIONS", () => {
  const baseContent = { "flow-agenda": "base" };

  function makeRepo(current: Record<string, unknown>): ComputeDeviationsRepository {
    return {
      async findProjectBinding() {
        return { blueprintId: "bp-1", baseVersionId: "v-1", baseContent };
      },
      async findCurrentProjectContent() {
        return current;
      },
    };
  }

  it("无项目角色 ⇒ NO_PROJECT_ROLE", async () => {
    await expect(
      computeDeviationsUseCase(
        { repo: makeRepo({ "flow-agenda": "changed" }) },
        { orgId: toOrgId("org-1"), projectId: "p-1", actorProjectRole: null },
      ),
    ).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" } satisfies Partial<ComputeDeviationsError>);
  });

  it("非引导师（如 observer）⇒ ROLE_INSUFFICIENT", async () => {
    await expect(
      computeDeviationsUseCase(
        { repo: makeRepo({ "flow-agenda": "changed" }) },
        { orgId: toOrgId("org-1"), projectId: "p-1", actorProjectRole: "observer" },
      ),
    ).rejects.toMatchObject({ reasonCode: "ROLE_INSUFFICIENT" });
  });

  it("项目未绑定任何蓝本 ⇒ DEPENDENCY_UNAVAILABLE", async () => {
    const repo: ComputeDeviationsRepository = {
      async findProjectBinding() {
        return null;
      },
      async findCurrentProjectContent() {
        return {};
      },
    };
    await expect(
      computeDeviationsUseCase(
        { repo },
        { orgId: toOrgId("org-1"), projectId: "p-1", actorProjectRole: "facilitator" },
      ),
    ).rejects.toMatchObject({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
  });

  it("完全照蓝本跑 ⇒ NO_DEVIATIONS（真实空态，不强行凑条目）", async () => {
    await expect(
      computeDeviationsUseCase(
        { repo: makeRepo({ "flow-agenda": "base" }) },
        { orgId: toOrgId("org-1"), projectId: "p-1", actorProjectRole: "facilitator" },
      ),
    ).rejects.toMatchObject({ reasonCode: "NO_DEVIATIONS" });
  });

  it("有偏离时返回 deviations + baseVersionId", async () => {
    const out = await computeDeviationsUseCase(
      { repo: makeRepo({ "flow-agenda": "changed" }) },
      { orgId: toOrgId("org-1"), projectId: "p-1", actorProjectRole: "facilitator" },
    );
    expect(out.baseVersionId).toBe("v-1");
    expect(out.deviations).toEqual([
      { designFacetKey: "flow-agenda", beforeValue: "base", afterValue: "changed" },
    ]);
  });
});
