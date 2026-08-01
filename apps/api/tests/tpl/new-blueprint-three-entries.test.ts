import { describe, expect, it } from "vitest";
import { templates } from "@repo/contracts";
import {
  planBlankBlueprint,
  planCopyBlueprint,
  planReverseFromProject,
} from "../../src/domain/templates/create-blueprint";
import { createBlueprint } from "../../src/application/templates/create-blueprint";
import { designFacetKeys } from "../../src/domain/templates/design-facet-table";

/**
 * F22 —— **新建蓝本三入口**（A0：空白 / 套用已有 / 从历史项目反向生成）。
 *
 * 三入口共用同一份 out 形状，但 `unmappedDesignFacetKeys` 与 `machineGenerated`
 * 的语义按入口刻意不同（见 `create-blueprint.ts` 头注）——本文件逐入口证明。
 */

describe("入口一：空白", () => {
  it("没有映射这回事，unmappedDesignFacetKeys 恒空，machineGenerated 恒 false", () => {
    const plan = planBlankBlueprint();
    expect(plan.content).toEqual({});
    expect(plan.unmappedDesignFacetKeys).toEqual([]);
    expect(plan.machineGenerated).toBe(false);
  });
});

describe("入口二：套用已有", () => {
  it("整份拷贝源蓝本已填内容", () => {
    const source = { basic: "已填", output: "也填了" };
    const plan = planCopyBlueprint(source);
    expect(plan.content).toEqual(source);
    // 不是同一个引用——改新蓝本不影响源蓝本（V5 同款不变量）
    expect(plan.content).not.toBe(source);
  });

  it("源本身缺的槽位不计入 unmappedDesignFacetKeys —— 那是「没填」不是「映射不上」", () => {
    const plan = planCopyBlueprint({ basic: "只填了这一项" });
    expect(plan.unmappedDesignFacetKeys).toEqual([]);
    expect(plan.machineGenerated).toBe(false);
  });
});

describe("入口三：从历史项目反向生成", () => {
  it("machineGenerated 恒 true", () => {
    const plan = planReverseFromProject(new Map());
    expect(plan.machineGenerated).toBe(true);
  });

  it("能对上号的项进 content，对不上号的进 unmappedDesignFacetKeys（V13：告警不是失败）", () => {
    const allKeys = designFacetKeys();
    const firstKey = allKeys[0]!;
    const mapped = new Map([[firstKey, "从项目问卷抽取的值"]]);
    const plan = planReverseFromProject(mapped);

    expect(plan.content[firstKey]).toBe("从项目问卷抽取的值");
    expect(plan.unmappedDesignFacetKeys).toEqual(allKeys.filter((k) => k !== firstKey));
    // 未映射的项确实不出现在 content 里 —— 留空，不是填了一个占位值
    for (const key of plan.unmappedDesignFacetKeys) {
      expect(Object.prototype.hasOwnProperty.call(plan.content, key)).toBe(false);
    }
  });

  it("全部映射成功 ⇒ unmappedDesignFacetKeys 为空（映射不全不是必然结果）", () => {
    const allKeys = designFacetKeys();
    const mapped = new Map(allKeys.map((k) => [k, `值-${k}`]));
    const plan = planReverseFromProject(mapped);
    expect(plan.unmappedDesignFacetKeys).toEqual([]);
    expect(Object.keys(plan.content).sort()).toEqual([...allKeys].sort());
  });

  it("全部映射失败 ⇒ unmappedDesignFacetKeys 穷举整张表", () => {
    const plan = planReverseFromProject(new Map());
    expect(plan.unmappedDesignFacetKeys).toEqual(designFacetKeys());
    expect(plan.content).toEqual({});
  });
});

describe("用例层：createBlueprint 按 origin 分派，输出满足契约 out 形状", () => {
  it("blank", () => {
    const out = createBlueprint({ origin: "blank", blueprintId: "bp-blank" });
    expect(out).toEqual({ blueprintId: "bp-blank", unmappedDesignFacetKeys: [], machineGenerated: false });
    expect(templates.operations.createBlueprint.out.safeParse(out).success).toBe(true);
  });

  it("copy", () => {
    const out = createBlueprint({
      origin: "copy",
      blueprintId: "bp-copy",
      sourceContent: { basic: "x" },
    });
    expect(out).toEqual({ blueprintId: "bp-copy", unmappedDesignFacetKeys: [], machineGenerated: false });
    expect(templates.operations.createBlueprint.out.safeParse(out).success).toBe(true);
  });

  it("reverse-from-project", () => {
    const firstKey = designFacetKeys()[0]!;
    const out = createBlueprint({
      origin: "reverse-from-project",
      blueprintId: "bp-reverse",
      mappedFacets: new Map([[firstKey, "v"]]),
    });
    expect(out.blueprintId).toBe("bp-reverse");
    expect(out.machineGenerated).toBe(true);
    expect(out.unmappedDesignFacetKeys).toContain(designFacetKeys()[1]);
    expect(templates.operations.createBlueprint.out.safeParse(out).success).toBe(true);
  });
});

describe("契约面：三入口是 BlueprintOrigin 的全部成员，且 createBlueprint.in 接受三者", () => {
  it("BlueprintOrigin 恰好三个值", () => {
    expect(templates.BlueprintOrigin.options).toEqual(["blank", "copy", "reverse-from-project"]);
  });

  it("createBlueprint.in 对三种 origin 都能解析（sourceId 语义随入口而变，见契约注释）", () => {
    const base = { orgId: "org-1", name: "新蓝本" };
    expect(
      templates.operations.createBlueprint.in.safeParse({ ...base, origin: "blank", sourceId: null }).success,
    ).toBe(true);
    expect(
      templates.operations.createBlueprint.in.safeParse({ ...base, origin: "copy", sourceId: "bp-src" })
        .success,
    ).toBe(true);
    expect(
      templates.operations.createBlueprint.in.safeParse({
        ...base,
        origin: "reverse-from-project",
        sourceId: "project-src",
      }).success,
    ).toBe(true);
  });
});
