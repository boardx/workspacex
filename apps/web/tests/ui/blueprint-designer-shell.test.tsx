import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  BlueprintDesignerShell,
  type BlueprintDesignerShellProps,
} from "@/components/tpl-designer/blueprint-designer-shell";
import { DESIGN_FACET_CATALOG, type DesignFacetCatalog } from "@/lib/generated/design-facet-catalog";

/**
 * F18 —— 蓝本设计器外壳的**界面**（`uc-2-1` R3 §3.0 / R8）。
 *
 * ## 目录那一组断言的是「集合相等」，不是「有 15 项」
 *
 * 纪律 9：断言性质不是数量。`toHaveLength(15)` 在两个方面都不够——
 * 它放过「长度对了但项不对」，又会在第 16 项的裁决落地时把一次正当的新增拦下来。
 * 这里断言的是**侧栏渲染出的项集合 ＝ 配置项定义表的 key 集合**，双向逐项点名。
 *
 * ## 「定义表」在前端是怎么到手的（这条链必须自己证明）
 *
 * 唯一事实源在 `apps/api/src/domain/templates/design-facet-table.ts`，前端不能 import 它，
 * 拿到的是**机械生成**的 `lib/generated/design-facet-catalog.ts`。副本允许存在，
 * 但必须有门控证明它没漂移 —— 所以本文件**第一条**就把生成器的 `--check` 跑一遍。
 * 少了这一条，下面所有断言证明的只是「侧栏渲染了它自己拿到的那份清单」，
 * 那份清单可以已经和后端分家三个月。
 *
 * ## 空集不算通过
 *
 * `expectSameFacetSet` 自带非空前提，并有一条用例证明它在两边都空时确实会红。
 */

/** 集合相等（双向、逐项点名）+ 非空前提。⚠ 两边都空 ⇒ 抛错 */
function expectSameFacetSet(actual: readonly string[], expected: readonly string[], why: string): void {
  expect(expected.length, `${why}：期望集合为空，断言会平凡为真`).toBeGreaterThan(0);
  expect(actual.length, `${why}：实际集合为空`).toBeGreaterThan(0);
  const a = new Set(actual);
  const e = new Set(expected);
  for (const key of e) expect(a.has(key), `${why}：侧栏少了 ${key}`).toBe(true);
  for (const key of a) expect(e.has(key), `${why}：侧栏多了 ${key}`).toBe(true);
  expect(a.size, `${why}：有重复项`).toBe(actual.length);
}

const catalogKeys = (catalog: DesignFacetCatalog) =>
  catalog.groups.flatMap((g) => g.items.map((i) => i.designFacetKey));

/** 原型那一屏的取值：v4 已发布 · 用过 12 次 · 改动生成 v5 */
const baseProps: BlueprintDesignerShellProps = {
  blueprintName: "HMW 定题项目",
  versionBar: {
    state: "published",
    publishedVersionNumber: 4,
    nextVersionNumber: 5,
    appliedProjectCount: 12,
  },
  actions: [
    { id: "preview-participant-view", versionNumber: null },
    { id: "trial-run", versionNumber: null },
    { id: "publish", versionNumber: 5 },
  ],
  catalog: DESIGN_FACET_CATALOG,
  completeness: { done: 0, denominator: DESIGN_FACET_CATALOG.denominator },
  completedKeys: [],
  firstIncompleteRequiredKey: null,
  autosave: { status: "saved", lastSavedAt: "14:52", failure: null },
};

const renderShell = (patch: Partial<BlueprintDesignerShellProps> = {}) => {
  render(<BlueprintDesignerShell {...baseProps} {...patch} />);
  return screen.getByTestId("bp-designer-shell");
};

/** 侧栏里实际渲染出来的 facet key（从 data-testid 反读，不从 props 反读） */
function renderedFacetKeys(): string[] {
  const nav = screen.getByTestId("bp-designer-facet-catalog");
  return within(nav)
    .queryAllByTestId(/^bp-designer-facet-/)
    .map((el) => el.getAttribute("data-testid")!.replace("bp-designer-facet-", ""));
}

describe("目录来自配置项定义表（而不是前端自己列的一份）", () => {
  it("生成的目录与后端定义表没有漂移（机械门控，不是靠人看）", () => {
    // cwd 是 apps/web（vitest 的 root）；不用 import.meta.url 是因为 vitest 下它不一定是 file: URL
    const apiDir = join(process.cwd(), "..", "api");
    const out = execFileSync("pnpm", ["exec", "tsx", "scripts/gen-design-facet-catalog.ts", "--check"], {
      cwd: apiDir,
      encoding: "utf8",
    });
    expect(out).toContain("in sync");
    // 门控解析到的目录不能是空的，否则「同步」是一句关于空集的真话
    expect(catalogKeys(DESIGN_FACET_CATALOG).length).toBeGreaterThan(0);
  });

  it("侧栏渲染出的项集合 ＝ 目录的 key 集合（双向、逐项点名）", () => {
    renderShell();
    expectSameFacetSet(renderedFacetKeys(), catalogKeys(DESIGN_FACET_CATALOG), "侧栏 vs 定义表");
  });

  it("每一项都带着它在表里的标题（key 对上而文字对不上也算漂移）", () => {
    renderShell();
    for (const group of DESIGN_FACET_CATALOG.groups) {
      for (const item of group.items) {
        expect(screen.getByTestId(`bp-designer-facet-${item.designFacetKey}`)).toHaveTextContent(item.label);
      }
    }
  });

  it("五个分组标题都在，空组也出现（「本组没有项」与「不分这一组」必须可分辨）", () => {
    const emptiedGroup = DESIGN_FACET_CATALOG.groups[0]!.group;
    const withEmptyGroup: DesignFacetCatalog = {
      ...DESIGN_FACET_CATALOG,
      groups: DESIGN_FACET_CATALOG.groups.map((g) => (g.group === emptiedGroup ? { ...g, items: [] } : g)),
    };
    renderShell({ catalog: withEmptyGroup });

    for (const g of withEmptyGroup.groups) {
      expect(screen.getByTestId(`bp-designer-group-${g.group}`)).toHaveTextContent(g.label);
    }
    expect(screen.getByTestId(`bp-designer-group-empty-${emptiedGroup}`)).toBeVisible();
  });

  it("表里加一项 ⇒ 侧栏立刻多一项（目录是投影，不是副本）", () => {
    const grown: DesignFacetCatalog = {
      denominator: DESIGN_FACET_CATALOG.denominator + 1,
      groups: DESIGN_FACET_CATALOG.groups.map((g, idx) =>
        idx === 0
          ? { ...g, items: [...g.items, { designFacetKey: "a-brand-new-slot", label: "新槽位", required: false, ordinal: 99 }] }
          : g,
      ),
    };
    renderShell({ catalog: grown, completeness: { done: 0, denominator: grown.denominator } });
    expectSameFacetSet(renderedFacetKeys(), catalogKeys(grown), "加一行后的侧栏");
    expect(screen.getByTestId("bp-designer-facet-a-brand-new-slot")).toBeVisible();
  });

  it("反证：集合相等断言在两边都空时必须变红，且空目录渲染成显式空态", () => {
    expect(() => expectSameFacetSet([], [], "空 vs 空")).toThrow();

    const empty: DesignFacetCatalog = { denominator: DESIGN_FACET_CATALOG.denominator, groups: [] };
    renderShell({ catalog: empty });
    expect(renderedFacetKeys()).toEqual([]);
    // 空目录不是「都填完了」，界面必须说出来
    expect(screen.getByTestId("empty")).toBeVisible();
    expect(() => expectSameFacetSet(renderedFacetKeys(), catalogKeys(empty), "空目录")).toThrow();
  });

  it("反证：少一项 / 多一项都被抓到（长度相等也不放过）", () => {
    const keys = catalogKeys(DESIGN_FACET_CATALOG);
    expect(() => expectSameFacetSet(keys.slice(1), keys, "少一项")).toThrow();
    expect(() => expectSameFacetSet([...keys, "ghost"], keys, "多一项")).toThrow();
    const swapped = [...keys.slice(1), "ghost"];
    expect(swapped.length).toBe(keys.length);
    expect(() => expectSameFacetSet(swapped, keys, "换一项")).toThrow();
  });
});

describe("完成度 n/分母", () => {
  it("分母用服务端给的那个数，前端不数自己手里的项", () => {
    // 刻意让分母与项数不一致：前端若是自己数，这里会显示项数而不是分母
    const serverDenominator = DESIGN_FACET_CATALOG.denominator + 7;
    renderShell({ completeness: { done: 3, denominator: serverDenominator } });
    expect(screen.getByTestId("bp-designer-completeness")).toHaveTextContent(`3/${serverDenominator}`);
    expect(catalogKeys(DESIGN_FACET_CATALOG).length).not.toBe(serverDenominator);
  });

  it("已完成的项打 ✓，未完成的不打（完成标记来自服务端）", () => {
    const [first, second] = catalogKeys(DESIGN_FACET_CATALOG);
    renderShell({
      completedKeys: [first!],
      completeness: { done: 1, denominator: DESIGN_FACET_CATALOG.denominator },
    });
    expect(screen.getByTestId(`bp-designer-facet-${first}`)).toHaveTextContent("✓");
    expect(screen.getByTestId(`bp-designer-facet-${second}`)).not.toHaveTextContent("✓");
  });

  it("有未完成必填项时，点完成度直达那一项", () => {
    const target = catalogKeys(DESIGN_FACET_CATALOG).at(-1)!;
    const first = catalogKeys(DESIGN_FACET_CATALOG)[0]!;
    renderShell({ firstIncompleteRequiredKey: target });

    // 落地时选中的是第一项，点完成度后才跳到目标项 —— 否则这条断言恒真
    expect(screen.getByTestId(`bp-designer-facet-${first}`)).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByTestId("bp-designer-completeness"));
    expect(screen.getByTestId(`bp-designer-facet-${target}`)).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId(`bp-designer-facet-${first}`)).toHaveAttribute("aria-current", "false");
  });

  it("没有未完成必填项时不给死链接：按钮禁用 + 说明为什么", () => {
    renderShell({ firstIncompleteRequiredKey: null });
    expect(screen.getByTestId("bp-designer-completeness")).toBeDisabled();
    expect(screen.getByTestId("bp-designer-completeness-no-target")).toBeVisible();
  });
});

describe("版本条", () => {
  it("语义提示句原样呈现（这是用户敢改蓝本的前提，不是装饰文案）", () => {
    const bar = renderShell().querySelector('[data-testid="bp-designer-version-bar"]')!;
    expect(bar).toHaveTextContent("v4 已发布");
    expect(bar).toHaveTextContent("用过 12 次");
    expect(bar).toHaveTextContent("改动生成 v5，已开过的项目锁在自己的版本上");
  });

  it("数字来自 props（不是把原型那句话写死）", () => {
    renderShell({
      versionBar: { state: "published", publishedVersionNumber: 9, nextVersionNumber: 10, appliedProjectCount: 0 },
    });
    const bar = screen.getByTestId("bp-designer-version-bar");
    expect(bar).toHaveTextContent("v9 已发布");
    expect(bar).toHaveTextContent("用过 0 次");
    expect(bar).toHaveTextContent("改动生成 v10，已开过的项目锁在自己的版本上");
    expect(bar).not.toHaveTextContent("v4 已发布");
  });

  it("草稿态不显示版本号（不是显示成 v0）", () => {
    renderShell({
      versionBar: { state: "draft", publishedVersionNumber: null, nextVersionNumber: 1, appliedProjectCount: 0 },
    });
    const bar = screen.getByTestId("bp-designer-version-bar");
    expect(bar).toHaveTextContent("草稿 · 尚未发布");
    expect(bar).not.toHaveTextContent("v0");
  });
});

describe("三个动作", () => {
  it("三个按钮都在，发布按钮带下一版号", () => {
    renderShell();
    expect(screen.getByTestId("bp-designer-action-preview-participant-view")).toHaveTextContent("预览参与者视图");
    expect(screen.getByTestId("bp-designer-action-trial-run")).toHaveTextContent("试跑一场");
    expect(screen.getByTestId("bp-designer-action-publish")).toHaveTextContent("发布 v5");
    // 没有「保存」按钮：草稿是自动保存的（R3 §3.0 逐字）
    expect(within(screen.getByTestId("bp-designer-actions")).queryByText("保存")).toBeNull();
  });

  it("认不出的动作 id 显式渲染出来，不被悄悄吞掉", () => {
    renderShell({ actions: [...baseProps.actions, { id: "some-new-action", versionNumber: null }] });
    // 一个消失的按钮在界面上与「后端没返回它」完全同形，那是查不出来的缺陷
    expect(screen.getByTestId("bp-designer-action-some-new-action")).toHaveTextContent("未知动作");
  });
});

describe("草稿自动保存：失败时不得显示「已自动保存」（V12）", () => {
  it("成功态显示最后保存时刻", () => {
    renderShell();
    expect(screen.getByTestId("bp-designer-autosave")).toHaveTextContent("草稿自动保存 · 14:52");
    expect(screen.queryByTestId("err-autosave")).toBeNull();
  });

  it("失败态：失败看得见，且「草稿自动保存」这句话必须消失", () => {
    renderShell({ autosave: { status: "failed", lastSavedAt: "14:52", failure: "AUTOSAVE_FAILED" } });

    const alert = screen.getByTestId("err-autosave");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("自动保存失败（AUTOSAVE_FAILED）");
    expect(alert).toHaveTextContent("本次改动未保存");
    // 上次成功的时刻仍可显示 —— 它是真的，但它前面写的是「上次成功保存」而不是「已保存」
    expect(alert).toHaveTextContent("上次成功保存 14:52");
    // 草稿不丢那一半，界面要说出来，否则用户以为白打了
    expect(alert).toHaveTextContent("内容仍留在本页");

    expect(screen.queryByTestId("bp-designer-autosave")).toBeNull();
    expect(screen.getByTestId("bp-designer-shell")).not.toHaveTextContent("草稿自动保存 · 14:52");
  });

  it("保存中不谎称已保存", () => {
    renderShell({ autosave: { status: "saving", lastSavedAt: "14:52", failure: null } });
    expect(screen.getByTestId("bp-designer-autosave")).toHaveTextContent("正在保存草稿");
    expect(screen.getByTestId("bp-designer-shell")).not.toHaveTextContent("草稿自动保存 · 14:52");
  });

  it("从未保存过的新草稿不谎报时刻", () => {
    renderShell({ autosave: { status: "never-saved", lastSavedAt: null, failure: null } });
    expect(screen.getByTestId("bp-designer-autosave")).toHaveTextContent("草稿尚未保存过");
  });
});
