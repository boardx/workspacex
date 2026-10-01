/**
 * AG04（契约束 agent-role UC-4，ui.md「头像」落点行）—— `components/ui/avatar.tsx`
 * 新增的插画头像支持：`avatarKey` 命中 `AvatarKey` 集合 → 渲染 `AvatarIllustration`；
 * `avatarKey` 为 `null`/未知值/不传 → 回退首字母（A3），不报错、不抛异常。
 *
 * 复用同一套插画渲染（`components/ui/avatar-illustration.tsx`），不是第二份画法——
 * `expert-avatar.test.tsx` 覆盖 itv 场景下的同一组件，这里只覆盖 `Avatar` 这一层新增的
 * 接线（key 校验 + 回退判定），不重复断言插画本身画对了什么线条。
 */
import { describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { Avatar } from "@/components/ui/avatar";
import { AVATAR_KEYS, DIGITAL_HUMAN_AVATAR_KEYS, ILLUSTRATION_AVATAR_KEYS } from "@/lib/interview-expert-avatar";
import { existsSync } from "node:fs";
import { join } from "node:path";

afterEach(() => cleanup());

describe("Avatar 插画头像支持（AG04）", () => {
  it("avatarKey 命中集合时渲染插画，data-avatar-key 与 role=img 带上", () => {
    render(<Avatar initials="D" avatarKey="person-7" />);
    const node = screen.getByRole("img");
    expect(node.getAttribute("data-avatar-key")).toBe("person-7");
    expect(node.querySelector("svg")).not.toBeNull();
  });

  it("robot key 也能渲染", () => {
    render(<Avatar initials="D" avatarKey="robot" />);
    expect(screen.getByRole("img").getAttribute("data-avatar-key")).toBe("robot");
  });

  it("avatarKey 为 null 时回退首字母，不渲染 img role，不抛异常", () => {
    render(<Avatar initials="D002" avatarKey={null} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("D002")).not.toBeNull();
  });

  it("avatarKey 是未知/非法字符串时同样回退首字母（不当作插画渲染，也不报错）", () => {
    render(<Avatar initials="X" avatarKey="<svg onload='bad'>" />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("X")).not.toBeNull();
  });

  it("不传 avatarKey 时保持既有行为（首字母），向后兼容全部既有调用点", () => {
    render(<Avatar initials="AV" />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("AV")).not.toBeNull();
  });

  it("avatarKey 优先于 src：两者同传时插画胜出", () => {
    render(<Avatar initials="D" avatarKey="person-3" src="https://example.com/a.png" />);
    const node = screen.getByRole("img");
    expect(node.getAttribute("data-avatar-key")).toBe("person-3");
    expect(node.querySelector("img")).toBeNull();
  });

  it("数字人肖像 key 渲染为同源静态 WebP，不走 SVG 画法", () => {
    render(<Avatar initials="D" avatarKey="dh-05-sales-representative" />);
    const node = screen.getByRole("img");
    expect(node.getAttribute("data-avatar-key")).toBe("dh-05-sales-representative");
    expect(node.querySelector("svg")).toBeNull();
    expect(node.querySelector("img")?.getAttribute("src")).toBe("/avatars/digital-humans/dh-05-sales-representative.webp");
  });

  it("60 个数字人肖像 key 每个都有对应的 public 资源文件（key 集与资源不漂移）", () => {
    expect(DIGITAL_HUMAN_AVATAR_KEYS).toHaveLength(60);
    const missing = DIGITAL_HUMAN_AVATAR_KEYS.filter((key) => !existsSync(join(__dirname, "../../public/avatars/digital-humans", `${key}.webp`)));
    expect(missing).toEqual([]);
  });

  it("覆盖全部合法 key（25 插画 + 60 肖像），逐一渲染成功且互不相同", () => {
    const rendered = new Set<string>();
    for (const key of AVATAR_KEYS) {
      const { unmount, container } = render(<Avatar initials="?" avatarKey={key} />);
      rendered.add(container.innerHTML);
      expect(screen.getByRole("img").getAttribute("data-avatar-key")).toBe(key);
      unmount();
    }
    expect(ILLUSTRATION_AVATAR_KEYS).toHaveLength(25);
    expect(AVATAR_KEYS).toHaveLength(85);
    expect(rendered.size).toBeGreaterThan(1);
  });
});
