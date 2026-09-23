/**
 * 迭代 17（#3773 后续）—— 被丢掉的跳转要让**用户**看见，不能只进服务端日志。
 *
 * 在这之前：模型在回复里说「点「去结算」会进结算页」→ 那条 link 指向一个不存在的页
 * → 服务端逐条丢掉（这是对的）→ 用户切到预览按下去没反应，屏上没有任何痕迹。
 * 用户只会以为「可点击原型」这件事本身不好使。
 */
import { describe, expect, it } from "vitest";
import { designPrototype } from "@repo/contracts";
import { describeDroppedLinks } from "../../src/application/design-workbench/append-project-chat";

const drop = (
  screen: number,
  from: string,
  to: number,
  reason: designPrototype.LinkDropReason,
) => ({ screen, link: { from, to }, reason });

describe("被丢掉的跳转 → 给用户看的人话", () => {
  it("一条都没丢 ⇒ 空串（不给回复尾巴上挂一句没用的话）", () => {
    expect(describeDroppedLinks([], ["首页"])).toBe("");
  });

  it("说得出是哪一页的哪个节点、为什么，以及下一步", () => {
    // ⭐ 反证锚点：只记日志不告诉用户 ⇒ 这条红。这正是本仓反复点名的
    // 「界面声称的事情没有真的发生」——模型说连好了，屏上点不动，而没人说破。
    const text = describeDroppedLinks([drop(0, "go", 9, "TARGET_OUT_OF_RANGE")], ["购物车", "结算"]);
    expect(text).toContain("有 1 条跳转没连上");
    expect(text).toContain("「购物车」");
    expect(text).toContain("go");
    expect(text).toContain("指向的页不存在");
    expect(text).toContain("预览时点它们不会有反应");
    // 用户据此能直接让模型补一句「把 X 连到 Y」。
    expect(text).toContain("告诉我该连到哪一页");
  });

  it("页标签取不到时退回页序号，不渲染成「undefined」", () => {
    expect(describeDroppedLinks([drop(3, "n1", 1, "SELF_LINK")], ["只有一页"])).toContain("第 3 页");
  });

  it("丢太多 ⇒ 只列前三条，其余报个数（一次连错十条通常是同一个原因）", () => {
    const many = Array.from({ length: 7 }, (_, i) => drop(0, `n${String(i)}`, 9, "TARGET_OUT_OF_RANGE"));
    const text = describeDroppedLinks(many, ["首页"]);
    expect(text).toContain("有 7 条跳转没连上");
    expect(text).toContain("还有 4 条同类问题");
    expect(text.split("·").length - 1).toBe(4); // 三条明细 + 一条「还有 N 条」
  });

  it("每一种原因都有话可说——闭集穷举，不会出现「说不出为什么」", () => {
    /*
     * ⭐ 反证锚点：契约加了一种新的丢弃原因而这里没跟上 ⇒ TS 编译不过（Record 穷举），
     * 真要绕过去让它落到运行期，这条也会红。少一种原因的表现是屏上说「有 1 条没连上」
     * 却说不出为什么——那比不说更让人困惑。
     */
    const reasons: designPrototype.LinkDropReason[] = [
      "TARGET_OUT_OF_RANGE", "SELF_LINK", "FROM_NOT_FOUND", "ITEM_OUT_OF_RANGE", "DUPLICATE", "TOO_MANY",
    ];
    for (const r of reasons) {
      const text = describeDroppedLinks([drop(0, "n1", 1, r)], ["首页"]);
      expect(text, `原因 ${r} 没有对应的人话`).toContain("：");
      expect(text).not.toContain("undefined");
    }
  });
});
