/**
 * 共享 Toggle 的禁用态（#4247 评审）：禁用必须看得出来，且禁用的「开」和「关」必须看得出区别——
 * 只读页面（无写权限的名册 / 项目设置 / 只读问卷）靠它读出当前值。
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toggle } from "@/components/ui/toggle";

function knobOf(label: string): HTMLElement {
  return screen.getByRole("switch", { name: label }).firstElementChild as HTMLElement;
}

describe("Toggle 禁用态", () => {
  it("禁用：轨道走禁用底 token，旋钮走对比色 token（不用 opacity）", () => {
    render(<Toggle checked label="开" onCheckedChange={() => {}} disabled />);
    const sw = screen.getByRole("switch", { name: "开" });
    expect(sw.hasAttribute("disabled")).toBe(true);
    expect(sw.className).toContain("disabled:bg-disabled");
    expect(sw.className).not.toMatch(/opacity/);
    expect(knobOf("开").className).toContain("group-disabled:bg-disabled-foreground");
  });

  it("禁用的「开」与禁用的「关」渲染不同（旋钮位置 + aria-checked）", () => {
    render(
      <>
        <Toggle checked label="开" onCheckedChange={() => {}} disabled />
        <Toggle checked={false} label="关" onCheckedChange={() => {}} disabled />
      </>,
    );
    expect(screen.getByRole("switch", { name: "开" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch", { name: "关" }).getAttribute("aria-checked")).toBe("false");
    expect(knobOf("开").className).toContain("translate-x-3.5");
    expect(knobOf("关").className).toContain("translate-x-0.5");
    expect(knobOf("开").className).not.toBe(knobOf("关").className);
  });
});
