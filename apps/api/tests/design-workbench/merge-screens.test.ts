/**
 * 迭代 11（delta §5 取舍 ②A）—— `mergeScreens` 是「一次 patch 怎么合进 screens」的**唯一**规则。
 *
 * 这套逻辑此前住在 SQL 的 CASE 里，本机没有 Postgres 就验不了，而它出错的代价是用户整份原型
 * 消失（#2900：只写 frames ⇒ 强制清空，纯改标签也把画好的三页带走）。挪成纯函数就是为了让
 * 下面这些用例存在——尤其是「纯改标签保留」和「加页不丢已有页」两条。
 */
import { describe, expect, it } from "vitest";
import { mergeScreens } from "../../src/infrastructure/design-workbench/pg-design-project-repository";
import type { PrototypeNode } from "../../src/application/design-workbench/project-ports";

const tree = (content: string): PrototypeNode => ({ type: "stack", children: [{ type: "text", props: { content } }] });
const base = [
  { frame: "对话", root: tree("一"), notes: "首页", links: [{ from: "n2", to: 1 }] },
  { frame: "设置", root: tree("二"), notes: "设置页", links: [] },
];

describe("mergeScreens", () => {
  it("只改标签且页数不变 ⇒ 树 / 说明 / 跳转逐位保留（#2900 的反证）", () => {
    const out = mergeScreens(base, { frames: ["首页", "设置"] });
    expect(out.map((s) => s.frame)).toEqual(["首页", "设置"]);
    expect(out[0]!.root).toEqual(tree("一"));
    expect(out[0]!.notes).toBe("首页");
    expect(out[0]!.links).toEqual([{ from: "n2", to: 1 }]);
  });

  it("只改标签且页数变了 ⇒ 新增页没有 root（回到「还没生成」），已有页不被凭空保留到错位", () => {
    const out = mergeScreens(base, { frames: ["对话", "设置", "用量"] });
    expect(out).toHaveLength(3);
    // 页数变了就不做逐位保留——按位置对应已经不成立，保留会把树接到错的页上
    expect(out.every((s) => s.root === undefined)).toBe(true);
  });

  it("整页写回 ⇒ 三者按位置覆盖；没给的字段保持原样", () => {
    const out = mergeScreens(base, {
      frames: ["A", "B"],
      prototype: [tree("新一"), tree("新二")],
      frameLinks: [[], [{ from: "n9", to: 0 }]],
    });
    expect(out[0]!.root).toEqual(tree("新一"));
    expect(out[1]!.links).toEqual([{ from: "n9", to: 0 }]);
    expect(out[0]!.notes).toBe("首页"); // frameNotes 没给 ⇒ 不动
  });

  it("只给 prototype（patch 那条路）⇒ 标签与说明不动", () => {
    const out = mergeScreens(base, { prototype: [tree("改一"), tree("改二")] });
    expect(out.map((s) => s.frame)).toEqual(["对话", "设置"]);
    expect(out[0]!.root).toEqual(tree("改一"));
    expect(out[0]!.notes).toBe("首页");
  });

  it("空说明不落键——`notes` 缺位与空串是同一件事，别在库里留一堆空字符串", () => {
    const out = mergeScreens(base, { frameNotes: ["", ""] });
    expect(out[0]!.notes).toBeUndefined();
  });
});
