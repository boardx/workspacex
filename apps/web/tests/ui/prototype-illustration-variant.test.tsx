/**
 * #4198 之后的另一半修复——`image(kind:illustration)` 此前对每一项都画同一个占位形状，
 * 一组并列选项里配几个反而像没做完（DESIGN_PRINCIPLES ⑬）。按节点 id/alt 稳定哈希出
 * 4 种形状里的一种：同一节点每次渲染形状不变，不同节点大多数情况下落到不同形状。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { PrototypeCanvas } from "@/components/design-loop/prototype-canvas";
import type { PrototypeNode } from "@/lib/live-design-workbench";

afterEach(cleanup);

const illustration = (id: string, alt: string): PrototypeNode => ({ id, type: "image", props: { alt, kind: "illustration" } });

function variantOf(id: string, alt: string): string | null {
  const { container, unmount } = render(<PrototypeCanvas label="页面" root={illustration(id, alt)} />);
  const v = container.querySelector('[data-proto="image"][data-image-kind="illustration"] svg')?.getAttribute("data-illustration-variant") ?? null;
  unmount();
  return v;
}

describe("illustration 占位形状", () => {
  it("同一个节点 id 每次渲染形状不变（哈希稳定，不是每次随机）", () => {
    const first = variantOf("opt-1", "选项一");
    const second = variantOf("opt-1", "选项一");
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  it("⭐ 反证锚点：一组不同 id 的 illustration 不再全都是同一个形状", () => {
    const variants = new Set(["opt-心情很好", "opt-还行", "opt-有点低落", "opt-很糟糕", "opt-说不清", "opt-需要倾诉"].map((id) => variantOf(id, id)));
    // 全同形状（size 1）说明哈希退化成了常量，等价于修复前"全组一个形状"的老问题。
    expect(variants.size).toBeGreaterThan(1);
  });

  it("没有 id 时退回按 alt 哈希，同样形状稳定", () => {
    const first = variantOf2("同一段说明");
    const second = variantOf2("同一段说明");
    expect(first).toBe(second);
  });
});

function variantOf2(alt: string): string | null {
  const node: PrototypeNode = { type: "image", props: { alt, kind: "illustration" } };
  const { container, unmount } = render(<PrototypeCanvas label="页面" root={node} />);
  const v = container.querySelector('[data-proto="image"][data-image-kind="illustration"] svg')?.getAttribute("data-illustration-variant") ?? null;
  unmount();
  return v;
}
