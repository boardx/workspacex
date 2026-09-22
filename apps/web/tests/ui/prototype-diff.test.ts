/** 迭代 16（#3773 R5）：「这一轮改了什么」的判据。 */
import { describe, expect, it } from "vitest";
import { changedNodeIds } from "@/lib/prototype-diff";
import type { PrototypeNode } from "@/lib/live-design-workbench";

const btn = (id: string, label: string): PrototypeNode =>
  ({ id, type: "button", props: { label } }) as unknown as PrototypeNode;
const stack = (id: string, children: PrototypeNode[]): PrototypeNode =>
  ({ id, type: "stack", children }) as unknown as PrototypeNode;

describe("changedNodeIds", () => {
  it("改了一个按钮文案 ⇒ 只报那一个，**父容器不跟着亮**", () => {
    // ⭐ 反证锚点：把 children 塞进比较里 ⇒ 这条红（从根到叶整条链全亮，等于没有高亮）。
    const before = [stack("s", [btn("b1", "保存"), btn("b2", "取消")])];
    const after = [stack("s", [btn("b1", "保存修改"), btn("b2", "取消")])];
    expect([...changedNodeIds(before, after)]).toEqual(["b1"]);
  });

  it("新增的节点算改动", () => {
    const before = [stack("s", [btn("b1", "保存")])];
    const after = [stack("s", [btn("b1", "保存"), btn("b9", "删除")])];
    expect([...changedNodeIds(before, after)]).toEqual(["b9"]);
  });

  it("删掉的节点**不报**——它已经不在树上，屏上没有东西可以高亮", () => {
    const before = [stack("s", [btn("b1", "保存"), btn("b2", "取消")])];
    const after = [stack("s", [btn("b1", "保存")])];
    expect([...changedNodeIds(before, after)]).toEqual([]);
  });

  it("本来就没有原型（首次生成）⇒ 空集，不是整棵树全是新的", () => {
    const after = [stack("s", [btn("b1", "保存")])];
    expect([...changedNodeIds([], after)]).toEqual([]);
    expect([...changedNodeIds([null, null], after)]).toEqual([]);
  });

  it("什么都没改 ⇒ 空集", () => {
    const tree = [stack("s", [btn("b1", "保存")])];
    expect([...changedNodeIds(tree, tree)]).toEqual([]);
  });
});
