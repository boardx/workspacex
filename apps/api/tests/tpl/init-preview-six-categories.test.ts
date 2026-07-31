import { describe, expect, it } from "vitest";
import { templates } from "@repo/contracts";
import {
  DESIGN_FACET_DEFINITIONS,
  designFacetKeys,
  type DesignFacetRow,
} from "../../src/domain/templates/design-facet-table";
import {
  INITIALIZATION_CATEGORIES,
  planInitializationPreview,
  toContractInitializationPreview,
} from "../../src/domain/templates/initialization-preview";
import { getInitializationPreview } from "../../src/application/templates/get-initialization-preview";

/** 表里每一行声明的 `initCategory`（null ⇒ 刻意不进一览）。测试读表，不重列一遍判断。 */
const initCategoryOf = (key: string): string | null =>
  DESIGN_FACET_DEFINITIONS.find((r) => r.designFacetKey === key)?.initCategory ?? null;

/**
 * F21 —— 「套用后会初始化什么」**六类一览**（`uc-2-1` R6 AC5 / I-17）。
 *
 * 两条性质要分别断言，不能合并成一条：
 *   ① **六类恒存在**（`categories` 恒等于契约 `InitializationCategory` 的枚举值集合，
 *      与草稿填了多少无关，空类也要出现——I-17「类别不可增删」）。
 *   ② **items 随已填的设计配置项实时变化**（V9）——同一份定义表，换一批已填 key
 *      就换一批 items，这是「实时变化」在纯函数世界里的样子。
 *
 * ⚠ 断言不点名具体 key（同 `required-column-drives-gate.test.ts` 的纪律）：
 *   「facet → category」的映射是本 feature 自己的判断（见 domain 文件头），
 *   逐个断言某个具体 key 落进哪一类会把这份判断焊死成契约,而它不是。
 *   本文件断言的是**映射表自证的性质**：映射到的类必须是六类之一、
 *   已填 key 变化时 items 的**集合**必须精确跟着变。
 */

describe("六类恒存在，且与契约的 InitializationCategory 逐项对得上（I-17）", () => {
  it("categories 恒等于契约枚举值集合，长度恒 6", () => {
    expect(INITIALIZATION_CATEGORIES.length).toBe(templates.InitializationCategory.options.length);
    expect(new Set(INITIALIZATION_CATEGORIES)).toEqual(new Set(templates.InitializationCategory.options));
  });

  it("一个字都没填的空草稿仍然给出六类，只是 items 为空 —— 空类与不存在必须可分辨", () => {
    const preview = planInitializationPreview([]);
    expect(preview.categories).toEqual(INITIALIZATION_CATEGORIES);
    expect(preview.items).toEqual([]);
  });

  it("填满全部设计配置项，一览里出现的类别集合仍然是六类的子集，不多不少地落在契约枚举内", () => {
    const preview = planInitializationPreview(designFacetKeys());
    for (const item of preview.items) {
      expect(templates.InitializationCategory.safeParse(item.category).success, item.category).toBe(true);
    }
    // categories 本身恒 6，不因为填满而增减
    expect(preview.categories).toEqual(INITIALIZATION_CATEGORIES);
  });
});

describe("items 随已填的设计配置项实时变化（V9）", () => {
  it("一次只填一项 ⇒ items 恒为 0 或 1 条（取决于该行表里的 initCategory）", () => {
    for (const key of designFacetKeys()) {
      const preview = planInitializationPreview([key]);
      const mapped = initCategoryOf(key);
      if (mapped === null) {
        expect(preview.items, key).toEqual([]);
        expect(preview.unmappedFacetKeys, key).toEqual([key]);
      } else {
        expect(preview.items, key).toEqual([{ category: mapped, key, label: expect.any(String) }]);
        expect(preview.unmappedFacetKeys, key).toEqual([]);
      }
    }
  });

  it("增填一项 ⇒ items 恰好多出那一项对应的条目，不影响其余已填项", () => {
    const mappedKeys = designFacetKeys().filter((k) => initCategoryOf(k) !== null);
    expect(mappedKeys.length, "表里应至少一行有 initCategory，否则这条断言平凡为真").toBeGreaterThan(1);

    const [first, second] = mappedKeys;
    const before = planInitializationPreview([first!]);
    const after = planInitializationPreview([first!, second!]);

    expect(after.items.length).toBe(before.items.length + 1);
    expect(after.items.map((i) => i.key)).toEqual(
      expect.arrayContaining([first!, second!]),
    );
  });

  it("撤空所有已填项 ⇒ items 清空 —— 一览不是「填过一次就一直显示」", () => {
    const filled = planInitializationPreview(designFacetKeys());
    expect(filled.items.length).toBeGreaterThan(0);
    const cleared = planInitializationPreview([]);
    expect(cleared.items).toEqual([]);
  });

  it("表外的 key（不在定义表里）既不进 items 也不进 unmappedFacetKeys —— 与 deriveCompleteness 对表外 key 的口径一致", () => {
    const preview = planInitializationPreview(["not-a-real-facet-key"]);
    expect(preview.items).toEqual([]);
    expect(preview.unmappedFacetKeys).toEqual([]);
  });

  it("新增一行定义表（表里自带 initCategory，代码零改动）⇒ 填它就出现在 items 里", () => {
    const extra: DesignFacetRow = {
      designFacetKey: "a-newly-added-slot",
      label: "新增配置项",
      group: "output",
      ordinal: 99,
      required: false,
      initCategory: "画布与产出物",
    };
    const table = [...DESIGN_FACET_DEFINITIONS, extra];
    const preview = planInitializationPreview(["a-newly-added-slot"], table);
    expect(preview.items).toEqual([
      { category: "画布与产出物", key: "a-newly-added-slot", label: "新增配置项" },
    ]);
  });

  it("新增一行不给 initCategory（沿用可选字段的默认行为）⇒ 该行不进 items，进 unmappedFacetKeys", () => {
    const extra: DesignFacetRow = {
      designFacetKey: "a-slot-without-category",
      label: "没配类别的新项",
      group: "output",
      ordinal: 100,
      required: false,
    };
    const table = [...DESIGN_FACET_DEFINITIONS, extra];
    const preview = planInitializationPreview(["a-slot-without-category"], table);
    expect(preview.items).toEqual([]);
    expect(preview.unmappedFacetKeys).toEqual(["a-slot-without-category"]);
  });
});

describe("topic-and-background 刻意不进任何一类（见 domain 文件头）", () => {
  it("单独填这一项 ⇒ items 为空，且它进 unmappedFacetKeys", () => {
    const preview = planInitializationPreview(["topic-and-background"]);
    expect(preview.items).toEqual([]);
    expect(preview.unmappedFacetKeys).toEqual(["topic-and-background"]);
  });
});

describe("application 层投影 = 契约 out 的形状（只有 categories / items 两个字段）", () => {
  it("getInitializationPreview 的返回体能被契约 out 解析", () => {
    const view = getInitializationPreview({ filledFacetKeys: designFacetKeys() });
    const parsed = templates.operations.getInitializationPreview.out.safeParse(view);
    expect(parsed.success, JSON.stringify(view)).toBe(true);
  });

  it("toContractInitializationPreview 投影掉了 unmappedFacetKeys —— 契约 out 是 .strict()，多一个字段会被拒", () => {
    const preview = planInitializationPreview(["topic-and-background"]);
    const projected = toContractInitializationPreview(preview);
    expect(Object.keys(projected)).toEqual(["categories", "items"]);
    expect(templates.operations.getInitializationPreview.out.safeParse(projected).success).toBe(true);
  });
});
