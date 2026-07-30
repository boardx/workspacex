import { describe, expect, it } from "vitest";
import { templates } from "@repo/contracts";
import {
  DESIGN_FACET_DEFINITIONS,
  designFacetKeys,
  requiredDesignFacetKeys,
  type DesignFacetRow,
} from "../../src/domain/templates/design-facet-table";
import { evaluateRequiredFacetGate } from "../../src/domain/templates/publish-gate";

/**
 * F17 —— **`required` 布尔列驱动发布门槛**（I-6，`uc-2-1` AC3b / V6）。
 *
 * V1 逐字：「断言写成『由 `required` 列驱动』**而非**『第 N 项必填』——
 * 这样必填清单日后怎么定都不改测试」。
 * ⇒ 本文件里**没有任何一个具体项被点名**。每条断言都对**表里的每一行**跑一遍，
 * 判定语句是「存在 `required = true` 且未完成的项 ⇒ 阻断」，与是哪几项无关。
 *
 * ⚠ 今天真实表里 `required` **全为 false**，这不是「门没实现」：
 *   哪些必填是数据缺口 D-2（O-18 ⑤：「清单本身无依据，仍需人类给出」），
 *   而原型里 `15/16`、`12/16`、`9/16` 的蓝本**均为已发布**（D-9 与 AC3b 正面冲突，
 *   `KNOWN_CONTRACT_GAPS.T3` 登记在案，**待人类裁决，本 feature 不选边**）。
 *   所以门的**行为**必须用改过 `required` 列的表来证明——只对真实表断言「没被拦」
 *   会让一个根本没实现的门也全绿。
 */

/** 把某一行的 `required` 翻成给定值，其余行原样。⚠ 不动磁盘上的表。 */
function withRequired(key: string, required: boolean): DesignFacetRow[] {
  return DESIGN_FACET_DEFINITIONS.map((r) => (r.designFacetKey === key ? { ...r, required } : r));
}

describe("必填清单来自 required 列", () => {
  it("必填集合恒等于 required = true 的行", () => {
    expect(requiredDesignFacetKeys()).toEqual(
      DESIGN_FACET_DEFINITIONS.filter((r) => r.required).map((r) => r.designFacetKey),
    );
  });

  it("现状：真实表零必填 —— 这是数据缺口 D-2，不是门不存在", () => {
    // 与原型一致：完成度不满仍可发布。把它写成断言，是为了让 D-2 一旦被填上，
    // 这条会红并逼人回来看一眼，而不是悄悄改变了发布行为。
    expect(requiredDesignFacetKeys()).toEqual([]);
    expect(evaluateRequiredFacetGate([]).blocked).toBe(false);
  });
});

describe("门的判定语句与「是哪几项」无关（I-6）", () => {
  it("把任一项置 required 并留空 ⇒ 被拒，且错误指向该项", () => {
    // 对每一行都跑一遍：清单日后怎么定，覆盖面都不用改。
    for (const row of DESIGN_FACET_DEFINITIONS) {
      const key = row.designFacetKey;
      const table = withRequired(key, true);
      const others = designFacetKeys().filter((k) => k !== key);

      const verdict = evaluateRequiredFacetGate(others, table);
      expect(verdict.blocked, `${key} 置 required 后留空却放行了`).toBe(true);
      expect(verdict.missingKeys).toEqual([key]);
    }
  });

  it("补齐该项 ⇒ 放行（同一张表，只改完成情况）", () => {
    for (const row of DESIGN_FACET_DEFINITIONS) {
      const table = withRequired(row.designFacetKey, true);
      const verdict = evaluateRequiredFacetGate([row.designFacetKey], table);
      expect(verdict.blocked, `${row.designFacetKey} 已补齐却仍被拦`).toBe(false);
      expect(verdict.missingKeys).toEqual([]);
    }
  });

  it("把该项 required 改回 false ⇒ 即使仍留空也可发布（V6 的第三段）", () => {
    for (const row of DESIGN_FACET_DEFINITIONS) {
      const table = withRequired(row.designFacetKey, false);
      expect(evaluateRequiredFacetGate([], table).blocked, row.designFacetKey).toBe(false);
    }
  });

  it("多项必填时，missingKeys 穷举全部缺口 —— 不是只报第一个", () => {
    const table = DESIGN_FACET_DEFINITIONS.map((r) => ({ ...r, required: true }));
    const verdict = evaluateRequiredFacetGate([], table);
    expect(verdict.blocked).toBe(true);
    expect(verdict.missingKeys).toEqual(designFacetKeys());
  });

  it("非必填项留空不进 missingKeys —— 门只看 required 列", () => {
    const key = designFacetKeys()[0]!;
    const table = withRequired(key, true);
    // 全都没完成，但只有那一项是必填的
    expect(evaluateRequiredFacetGate([], table).missingKeys).toEqual([key]);
  });

  it("新增的表行也自动进门 —— 加一行 required 的槽位，无需改一行代码", () => {
    const extra: DesignFacetRow = {
      designFacetKey: "a-newly-required-slot",
      label: "新必填项",
      group: "output",
      ordinal: 99,
      required: true,
    };
    const verdict = evaluateRequiredFacetGate(designFacetKeys(), [...DESIGN_FACET_DEFINITIONS, extra]);
    expect(verdict.blocked).toBe(true);
    expect(verdict.missingKeys).toEqual(["a-newly-required-slot"]);
  });
});

describe("被拒时用的是契约里已有的那个码", () => {
  it("REQUIRED_CONFIG_INCOMPLETE 是 publishBlueprintVersion 的失败面成员", () => {
    // 门在领域层判定，码在契约里。两边对不上时，界面会拿到一个它不认识的失败。
    expect(templates.TemplateError.safeParse("REQUIRED_CONFIG_INCOMPLETE").success).toBe(true);
    expect(templates.operations.publishBlueprintVersion.err).toContain("REQUIRED_CONFIG_INCOMPLETE");
    // 反向：契约确实会拒绝一个不存在的码，否则上一条可能在空转
    expect(templates.TemplateError.safeParse("REQUIRED_CONFIG_MISSING").success).toBe(false);
  });
});
