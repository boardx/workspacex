/**
 * `sanitizeReturnTo`——画布模板后台管理刷新掉回根目录一案的净化规则单测。
 * 见 `lib/return-to.ts` 头注 / `app-shell.tsx` 匿名跳转注释。
 */
import { describe, expect, it } from "vitest";
import { sanitizeReturnTo } from "@/lib/return-to";

describe("sanitizeReturnTo", () => {
  it("保留同源相对深链（含查询串）", () => {
    expect(sanitizeReturnTo("/canvas/template-admin")).toBe(
      "/canvas/template-admin",
    );
  });

  it("空值回落到 fallback（默认 /projects）", () => {
    expect(sanitizeReturnTo(null)).toBe("/projects");
    expect(sanitizeReturnTo(undefined)).toBe("/projects");
    expect(sanitizeReturnTo("")).toBe("/projects");
  });

  it("拒绝协议相对 / 跨域注入", () => {
    expect(sanitizeReturnTo("//evil.com")).toBe("/projects");
    expect(sanitizeReturnTo("https://evil.com/x")).toBe("/projects");
    expect(sanitizeReturnTo("evil.com")).toBe("/projects");
  });

  it("拒绝指回 /login 本身，避免登录成功后又跳回登录页的循环", () => {
    expect(sanitizeReturnTo("/login")).toBe("/projects");
    expect(sanitizeReturnTo("/login?next=%2Fprojects")).toBe("/projects");
  });

  it("支持自定义 fallback", () => {
    expect(sanitizeReturnTo(null, "/admin")).toBe("/admin");
  });
});
