/**
 * F12 · 链接落地页的手机号 + 验证码验证块（`join-verify-form`，uc-1-2 R3）。
 *
 * 纯前端断言，不碰数据库、不碰网络：
 *   · 三个稳定 testid 齐全（`join-phone` / `join-code` / `join-get-code`），
 *     且 `join-enter` 是进场的唯一入口；
 *   · 手机号仅以掩码回显（`138 •••• 2049`），说明文案里不出现完整号码；
 *   · 点击 [获取] 后按钮文案切到「已发送 · 重发」，并出现 `join-code-sent` 提示——
 *     这是「幂等重放：冷却期内重复请求返回同一 cooldownSec」在界面上唯一可见的投影；
 *   · `default` 场景下「已是组织成员直接免登」入口（`join-member-sso` /
 *     `join-member-continue`）与验证表单**同时可见**——D-01 两条路径并存，不是二选一。
 */
import { describe, expect, it } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { JoinForm } from "@/components/entry/join-form";
import { JOIN_CONTEXT } from "@/lib/mock/entry";

describe("F12 · join-verify-form", () => {
  it("default 场景：手机号、验证码、获取按钮、进场按钮四个稳定 testid 齐全", () => {
    const { container, unmount } = render(<JoinForm state="default" scene="default" role="member" />);
    expect(container.querySelector('[data-testid="join-verify-form"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="join-phone"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="join-code"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="join-get-code"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="join-enter"]')).not.toBeNull();
    unmount();
  });

  it("手机号只以掩码回显——说明文案里不出现完整号码", () => {
    const { container, unmount } = render(<JoinForm state="default" scene="default" role="member" />);
    expect(container.innerHTML).toContain(JOIN_CONTEXT.maskedPhone);
    // 掩码形如 "138 •••• 2049"：11 位连续数字不应该整段出现在 DOM 里。
    expect(container.innerHTML).not.toMatch(/\d{11}/);
    unmount();
  });

  it("点击 [获取] 后：按钮文案切到「已发送 · 重发」，并出现已发送提示", () => {
    const { container, unmount } = render(<JoinForm state="default" scene="default" role="member" />);
    const getCode = container.querySelector('[data-testid="join-get-code"]') as HTMLButtonElement;
    expect(getCode.textContent).toBe("获取");
    expect(container.querySelector('[data-testid="join-code-sent"]')).toBeNull();

    fireEvent.click(getCode);

    expect(getCode.textContent).toContain("已发送");
    expect(container.querySelector('[data-testid="join-code-sent"]')).not.toBeNull();
    unmount();
  });

  it("已是组织成员的免登入口与验证表单同时可见（D-01 两条路径并存）", () => {
    const { container, unmount } = render(<JoinForm state="default" scene="default" role="member" />);
    expect(container.querySelector('[data-testid="join-verify-form"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="join-member-sso"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="join-member-continue"]')).not.toBeNull();
    unmount();
  });

  it("组长链接：多出组长权限说明（join-lead-note），组员链接下不出现", () => {
    const lead = render(<JoinForm state="default" scene="default" role="groupLead" />);
    expect(lead.container.querySelector('[data-testid="join-lead-note"]')).not.toBeNull();
    lead.unmount();

    const member = render(<JoinForm state="default" scene="default" role="member" />);
    expect(member.container.querySelector('[data-testid="join-lead-note"]')).toBeNull();
    member.unmount();
  });
});
