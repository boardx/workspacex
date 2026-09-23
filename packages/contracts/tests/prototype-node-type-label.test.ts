/**
 * UIUX 第 19 轮：属性面板标题栏右边那一格原来印的是 `bottomnav` / `chip` 这种内部类型名。
 * 换成中文之后这一条盯住的是**覆盖**：新加一种原语却忘了给它一个中文名，编译不过（
 * `Record<PrototypeNodeType, string>` 穷举）之外再加一道运行时的，省得有人用 `as` 绕过去。
 */
import { describe, expect, it } from "vitest";
import { designPrototype } from "../src/index.js";

describe("PROTOTYPE_NODE_TYPE_LABEL", () => {
  it("每一种原语都有中文名，而且没有多余的键", () => {
    const types = [...designPrototype.PrototypeNodeType.options].sort();
    expect(Object.keys(designPrototype.PROTOTYPE_NODE_TYPE_LABEL).sort()).toEqual(types);
  });

  it("没有一个中文名是把英文原样抄回去的", () => {
    for (const [t, label] of Object.entries(designPrototype.PROTOTYPE_NODE_TYPE_LABEL)) {
      expect(label).not.toBe(t);
      expect(label).not.toMatch(/[A-Za-z]/);
    }
  });
});
