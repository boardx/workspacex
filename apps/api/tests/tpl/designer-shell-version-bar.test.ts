import { describe, expect, it } from "vitest";
import {
  DESIGN_FACET_DEFINITIONS,
  DESIGN_FACET_GROUPS,
  DESIGN_FACET_GROUP_LABEL,
  designFacetDenominator,
  designFacetKeys,
  requiredDesignFacetKeys,
  type DesignFacetRow,
} from "../../src/domain/templates/design-facet-table";
import {
  DESIGNER_ACTION_IDS,
  countAppliedProjects,
  deriveDesignerActions,
  deriveVersionBar,
  firstIncompleteRequiredFacet,
  type BlueprintBinding,
} from "../../src/domain/templates/designer-shell";
import type { BlueprintVersion } from "../../src/domain/templates/blueprint-version";
import { getDesignerShell, listDesignerCatalog } from "../../src/application/templates/get-designer-shell";

/**
 * F18 —— 设计器外壳：**版本条 · 三动作 · 五组目录 · 完成度**。
 *
 * ## 这里的断言都写成「性质」，不写成「数量」
 *
 * 目录那一组**没有 `toHaveLength(15)`**（纪律 9）。要守的性质是
 * **「侧栏里的项集合 ＝ 定义表里的 key 集合」**，两个方向逐项点名——
 * 长度相等的两个集合可以一个字都对不上，而第 16 项的裁决一旦落地，
 * 一条 `toHaveLength(15)` 就会把一次正当的新增拦在自己的测试上。
 *
 * ## 集合相等断言必须拒绝「两边都空」
 *
 * 空集恒等于空集。一个「渲染出来的项 ＝ 表里的项」在表被读空时会**平凡为真**——
 * 这正是本仓九次空转里最常见的一种。故 `expectSameKeySet` 自带非空前提，
 * 并有一条用例直接证明它会因此变红。
 */

/** 集合相等（双向、逐项点名）+ **非空前提**。⚠ 两边都空 ⇒ 抛错，不是通过 */
function expectSameKeySet(actual: readonly string[], expected: readonly string[], why: string): void {
  expect(expected.length, `${why}：期望集合为空，这条断言会平凡为真`).toBeGreaterThan(0);
  expect(actual.length, `${why}：实际集合为空`).toBeGreaterThan(0);
  const a = new Set(actual);
  const e = new Set(expected);
  for (const key of e) expect(a.has(key), `${why}：少了 ${key}`).toBe(true);
  for (const key of a) expect(e.has(key), `${why}：多了 ${key}`).toBe(true);
  expect(a.size, `${why}：有重复项`).toBe(actual.length);
}

const version = (n: number, state: BlueprintVersion["state"] = "published"): BlueprintVersion => ({
  id: `v${n}`,
  blueprintId: "bp-1",
  versionNumber: n,
  content: {},
  changedDesignFacetKeys: [],
  rolledBackFrom: null,
  state,
});

const bindings = (projects: number, trials: number): BlueprintBinding[] => [
  ...Array.from({ length: projects }, () => ({ kind: "project" }) as const),
  ...Array.from({ length: trials }, () => ({ kind: "trial-run" }) as const),
];

describe("版本条：v4 已发布 · 用过 12 次 · 改动生成 v5", () => {
  const history = [version(1), version(2), version(3), version(4)];

  it("已发布蓝本：版号取当前版本，下一版号 = 历史最大 + 1", () => {
    const bar = deriveVersionBar({ state: "published", bindings: bindings(12, 0) }, history, history[3]!);
    expect(bar.publishedVersionNumber).toBe(4);
    expect(bar.nextVersionNumber).toBe(5);
    expect(bar.appliedProjectCount).toBe(12);
  });

  it("归档过的旧版不让下一版号缩水（否则版本号会被复用，违反 I-3）", () => {
    const withArchived = [version(1, "archived"), version(2, "archived"), version(3, "archived"), version(4)];
    const bar = deriveVersionBar({ state: "published", bindings: [] }, withArchived, withArchived[3]!);
    // 「已发布版本数 + 1」在这里会算出 2 —— 一个会复用 v2 的号
    expect(bar.nextVersionNumber).toBe(5);
    expect(withArchived.filter((v) => v.state === "published").length + 1).not.toBe(bar.nextVersionNumber);
  });

  it("草稿态不显示版本号，且不是显示成 0（uc-2-4 R7）", () => {
    const bar = deriveVersionBar({ state: "draft", bindings: [] }, [], null);
    expect(bar.publishedVersionNumber).toBeNull();
    expect(bar.publishedVersionNumber).not.toBe(0);
    // 新蓝本第一次发布拿 v1（契约 versionNumber 为正整数）
    expect(bar.nextVersionNumber).toBe(1);
  });

  it("I-22：试跑不计入「用过 N 次」——反证用 bindings.length 会算错", () => {
    const mixed = bindings(12, 3);
    expect(countAppliedProjects(mixed)).toBe(12);
    // 「数全部绑定」是那个错误答案：它与正确答案不同，正好差掉试跑的那几条
    expect(mixed.length).toBe(countAppliedProjects(mixed) + 3);
    expect(mixed.length).not.toBe(countAppliedProjects(mixed));
    const bar = deriveVersionBar({ state: "published", bindings: mixed }, history, history[3]!);
    expect(bar.appliedProjectCount).toBe(12);

    // 只试跑、没套用 ⇒ 用过 0 次（而不是 3 次）
    expect(countAppliedProjects(bindings(0, 3))).toBe(0);
  });
});

describe("三个动作", () => {
  const bar = deriveVersionBar({ state: "published", bindings: bindings(12, 0) }, [version(4)], version(4));

  it("动作集合与顺序恒定，发布按钮带的号 = 版本条里的下一版号（同一个数）", () => {
    const actions = deriveDesignerActions(bar);
    expect(actions.map((a) => a.id)).toEqual([...DESIGNER_ACTION_IDS]);
    const publish = actions.find((a) => a.id === "publish")!;
    expect(publish.versionNumber).toBe(bar.nextVersionNumber);
    // 另外两个动作不带版本号：带上就意味着「预览 v5」这种没有依据的语义
    for (const a of actions.filter((x) => x.id !== "publish")) expect(a.versionNumber).toBeNull();
  });

  it("下一版号变了，按钮上的号跟着变（不是写死的 5）", () => {
    const later = deriveVersionBar({ state: "published", bindings: [] }, [version(9)], version(9));
    expect(deriveDesignerActions(later).find((a) => a.id === "publish")!.versionNumber).toBe(10);
  });
});

describe("五组目录：集合相等，不是「数够 15 个」", () => {
  it("目录里的项集合 ＝ 定义表的 key 集合（双向、逐项点名）", () => {
    const catalog = listDesignerCatalog();
    const rendered = catalog.groups.flatMap((g) => g.items.map((i) => i.designFacetKey));
    expectSameKeySet(rendered, designFacetKeys(), "目录 vs 定义表");
  });

  it("五个组恒存在（空组也出现），每组都有标题，标题来自定义表旁的唯一一份", () => {
    const catalog = listDesignerCatalog();
    expect(catalog.groups.map((g) => g.group)).toEqual([...DESIGN_FACET_GROUPS]);
    for (const g of catalog.groups) expect(g.label).toBe(DESIGN_FACET_GROUP_LABEL[g.group]);

    // 空组也必须出现：把某一组的行全删掉，那一组仍在目录里（否则「这组今天没项」
    // 与「我们不分这一组」在界面上同形）
    const first = DESIGN_FACET_DEFINITIONS[0]!.group;
    const withoutFirstGroup = DESIGN_FACET_DEFINITIONS.filter((r) => r.group !== first);
    const shrunk = listDesignerCatalog(withoutFirstGroup);
    expect(shrunk.groups.map((g) => g.group)).toEqual([...DESIGN_FACET_GROUPS]);
    expect(shrunk.groups.find((g) => g.group === first)!.items).toEqual([]);
  });

  it("分母由服务端给，且恒等于表的行数——改表即改目录与分母", () => {
    expect(listDesignerCatalog().denominator).toBe(designFacetDenominator());

    const extra: DesignFacetRow = {
      designFacetKey: "a-brand-new-slot",
      label: "新槽位",
      group: "output",
      ordinal: 99,
      required: false,
    };
    const grown = listDesignerCatalog([...DESIGN_FACET_DEFINITIONS, extra]);
    expect(grown.denominator).toBe(designFacetDenominator() + 1);
    expectSameKeySet(
      grown.groups.flatMap((g) => g.items.map((i) => i.designFacetKey)),
      [...designFacetKeys(), "a-brand-new-slot"],
      "加一行后的目录",
    );
  });

  it("反证：集合相等断言拒绝「两边都空」——否则表读空时它恒真", () => {
    expect(() => expectSameKeySet([], [], "空 vs 空")).toThrow();
    const emptyCatalog = listDesignerCatalog([]);
    expect(emptyCatalog.groups.flatMap((g) => g.items)).toEqual([]);
    expect(() =>
      expectSameKeySet(emptyCatalog.groups.flatMap((g) => g.items.map((i) => i.designFacetKey)), [], "空目录"),
    ).toThrow();
  });

  it("反证：漏一项 / 多一项都必须被抓到（集合相等不是长度相等）", () => {
    const keys = designFacetKeys();
    expect(() => expectSameKeySet(keys.slice(1), keys, "少一项")).toThrow();
    expect(() => expectSameKeySet([...keys, "ghost-slot"], keys, "多一项")).toThrow();
    // 长度相等但内容不同 —— toHaveLength 会放过它
    const swapped = [...keys.slice(1), "ghost-slot"];
    expect(swapped.length).toBe(keys.length);
    expect(() => expectSameKeySet(swapped, keys, "换一项")).toThrow();
  });
});

describe("完成度可点击：直达第一个未完成的必填项", () => {
  it("今天恒 null，是因为表里没有 required 的行（数据缺口 D-2），不是因为都填完了", () => {
    expect(requiredDesignFacetKeys()).toEqual([]);
    expect(firstIncompleteRequiredFacet([])).toBeNull();
    // 「都填完了」的那个解释要成立，得先有必填项 —— 没有，所以两种情形在这里可分辨
    expect(firstIncompleteRequiredFacet(designFacetKeys())).toBeNull();
  });

  it("表里一有 required 行就立刻有落点，且按目录序（组顺序 × 组内序）而不是数组序", () => {
    // 刻意把「靠后组、组内序小」的行排在数组更前面：按数组序会挑错人
    const later = DESIGN_FACET_DEFINITIONS.filter((r) => r.group === "output")[0]!;
    const earlier = DESIGN_FACET_DEFINITIONS.filter((r) => r.group === "basic")[0]!;
    const table: DesignFacetRow[] = [
      { ...later, required: true },
      { ...earlier, required: true },
      ...DESIGN_FACET_DEFINITIONS.filter((r) => r !== later && r !== earlier),
    ];

    expect(firstIncompleteRequiredFacet([], table)).toBe(earlier.designFacetKey);
    expect(firstIncompleteRequiredFacet([earlier.designFacetKey], table)).toBe(later.designFacetKey);
    expect(firstIncompleteRequiredFacet([earlier.designFacetKey, later.designFacetKey], table)).toBeNull();
  });
});

describe("外壳一次算齐（getDesignerShell）", () => {
  const shell = getDesignerShell({
    blueprint: { state: "published", bindings: bindings(12, 3) },
    history: [version(1), version(2), version(3), version(4)],
    currentVersion: version(4),
    completedKeys: designFacetKeys().slice(0, 3),
  });

  it("版本条 / 动作 / 目录 / 完成度四件齐全且互相一致", () => {
    expect(shell.versionBar.publishedVersionNumber).toBe(4);
    expect(shell.versionBar.appliedProjectCount).toBe(12);
    expect(shell.actions.find((a) => a.id === "publish")!.versionNumber).toBe(shell.versionBar.nextVersionNumber);
    expect(shell.completeness.done).toBe(3);
    expect(shell.completeness.denominator).toBe(shell.catalog.denominator);
    expectSameKeySet(
      shell.catalog.groups.flatMap((g) => g.items.map((i) => i.designFacetKey)),
      designFacetKeys(),
      "外壳目录 vs 定义表",
    );
  });

  it("已完成标记原样带给界面（界面不自己判哪项算完成）", () => {
    expectSameKeySet([...shell.completedKeys], designFacetKeys().slice(0, 3), "已完成集合");
    expect(shell.completeness.done).toBe(shell.completedKeys.length);
  });
});
