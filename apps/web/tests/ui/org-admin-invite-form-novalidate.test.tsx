/**
 * 邀请表单 noValidate 机械钉 —— 防第三次复发。
 *
 * 历史：邮箱输入是 `type="email"`，不加 `noValidate` 时浏览器 constraint validation 会把
 * `a@` 之类拦下弹**英文原生气泡**，本组件的中文预检与服务端结构化校验（`err-invite-email`）
 * 永远执行不到。PR #896 复核修过一次（`<form noValidate>`），后来表单重构把它弄丢、
 * 原样复发（invite-link-and-reads 独立复核第 4 条判 0）。本文件把它变成会红的东西：
 * 谁再删 `noValidate`（且仍用 `type="email"`），这里当场红。
 *
 * 断言的是**渲染出的 DOM 属性**，不是源码字符串——注释里出现 "noValidate" 骗不过它。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/live-org-admin", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/live-org-admin")>();
  return { ...mod, listTeams: vi.fn(async () => ({ teams: [] })) };
});

import { InviteMemberForm } from "@/components/org-admin/org-admin-screen";

describe("邀请表单不许把校验让给浏览器原生英文气泡", () => {
  it("form 带 noValidate，或邮箱输入不是 type=email（二者必居其一）", async () => {
    render(<InviteMemberForm orgId="org-novalidate-pin" onSucceeded={() => {}} onFailed={() => {}} onLink={() => {}} />);
    const form = screen.getByTestId<HTMLFormElement>("org-admin-invite-form");
    const email = screen.getByTestId<HTMLInputElement>("org-admin-invite-email");
    // noValidate 关掉 constraint validation ⇒ 中文校验（前端预检 + err-invite-email）才是防线。
    // 若未来有人把输入改成 type="text" inputMode="email"，同样不会弹原生气泡，也放行。
    expect(form.noValidate || email.type !== "email").toBe(true);
    // 收尾：等 listTeams 的挂载 effect 落定，避免 act 警告污染输出。
    await waitFor(() => expect(screen.getByTestId("org-admin-invite-team")).toBeInTheDocument());
  });
});
