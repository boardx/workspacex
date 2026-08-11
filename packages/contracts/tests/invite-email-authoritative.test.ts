import { describe, expect, it } from "vitest";
import * as auth from "../src/auth";
import * as orgAdmin from "../src/org-admin";

/**
 * invite-link-and-reads delta ③（coord-main 2026-08-11 裁决）：
 * `inviteOrgMember.in.email` 是服务端权威校验——垃圾邮箱在**契约层**被拒，
 * 不依赖前端预检。`ZodBodyPipe` 用的就是这同一个 schema 对象
 * （`org-invite.controller.ts` 的 `INVITE_ORG_MEMBER_SCHEMA` re-export，
 * `contract-single-source` 测试钉住"同一个对象不是长得像"），所以这里红 = 线上放行。
 */
describe("inviteOrgMember.in.email 服务端权威校验（delta ③）", () => {
  const base = { orgId: "org-x", orgRole: "consultant", teamId: "" };

  it.each(["a@", "a", "@b.com", "a b@c.com", ""])("拒绝垃圾输入 %j", (email) => {
    const r = orgAdmin.operations.inviteOrgMember.in.safeParse({ ...base, email });
    expect(r.success).toBe(false);
    if (!r.success) {
      // 失败落在 email 字段上——前端靠这个 path 渲染字段级文案，不是兜底 400。
      expect(r.error.issues.some((i) => i.path.join(".") === "email")).toBe(true);
    }
  });

  it("放行正常邮箱", () => {
    expect(orgAdmin.operations.inviteOrgMember.in.safeParse({ ...base, email: "a@b.com" }).success).toBe(true);
  });

  it("email 字段与 auth.EmailAddress 是同一份事实（不是第二份手写正则）", () => {
    // zod schema 无法直接比引用（.strict() 包装过），断言行为一致 + 具名 schema 存在。
    expect(auth.EmailAddress.safeParse("a@").success).toBe(false);
    expect(auth.EmailAddress.safeParse("a@b.com").success).toBe(true);
    const emailField = orgAdmin.operations.inviteOrgMember.in.shape.email;
    expect(emailField).toBe(auth.EmailAddress);
  });
});
