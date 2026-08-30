/**
 * `safeRelativePath`——`?from=` 回跳目的地的校验，见 `apps/web/lib/safe-relative
 * -path.ts` 头注（用于 `admin/skill/[id]/page.tsx` / `admin/agent/[id]/page.tsx`
 * 把「编辑」链接自己拼的 `?from=` 解析成 `CapabilityEditPage` 的 `backHref` 之前）。
 */
import { describe, expect, it } from "vitest";
import { safeRelativePath } from "@/lib/safe-relative-path";

describe("safeRelativePath", () => {
  it("接受单个 / 开头的同源相对路径，原样返回", () => {
    expect(safeRelativePath("/skill")).toBe("/skill");
    expect(safeRelativePath("/skill?screen=catalog")).toBe("/skill?screen=catalog");
    expect(safeRelativePath("/admin/agent?tab=roster")).toBe("/admin/agent?tab=roster");
  });

  it("拒绝空值", () => {
    expect(safeRelativePath(null)).toBeNull();
    expect(safeRelativePath(undefined)).toBeNull();
    expect(safeRelativePath("")).toBeNull();
  });

  it("拒绝协议相对 URL（// 开头）——浏览器会当成跳到另一个 host", () => {
    expect(safeRelativePath("//evil.com")).toBeNull();
    expect(safeRelativePath("//evil.com/admin/skill")).toBeNull();
  });

  it("拒绝反斜杠开头——`/\\evil.com` 会被部分浏览器解析成 `//evil.com`", () => {
    expect(safeRelativePath("/\\evil.com")).toBeNull();
  });

  it("拒绝绝对 URL 与非 http(s) scheme", () => {
    expect(safeRelativePath("https://evil.com")).toBeNull();
    expect(safeRelativePath("http://evil.com/admin/skill")).toBeNull();
    expect(safeRelativePath("javascript:alert(1)")).toBeNull();
  });

  it("拒绝不以 / 开头的相对路径（浏览器会相对当前路径解析，落点不确定）", () => {
    expect(safeRelativePath("skill")).toBeNull();
    expect(safeRelativePath("../admin")).toBeNull();
  });
});
