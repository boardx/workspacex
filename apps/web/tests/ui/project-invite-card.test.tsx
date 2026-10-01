/**
 * #4788 通用项目邀请（前端）· 「邀请成员」卡：按邮箱（逐个结果 + 失败可重发）/ 按链接（生成·复制·重置）/
 * 待处理邀请（状态、重发的禁用原因、撤销先确认）。只 mock 网络边界与会话。
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";

const listInvitations = vi.fn();
const createEmailInvitations = vi.fn();
const issueInviteLink = vi.fn();
const resendInvitation = vi.fn();
const revokeInvitation = vi.fn();

vi.mock("@/lib/live-project-invitations", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-project-invitations")>()),
  listInvitations: (...a: unknown[]) => listInvitations(...a),
  createEmailInvitations: (...a: unknown[]) => createEmailInvitations(...a),
  issueInviteLink: (...a: unknown[]) => issueInviteLink(...a),
  resendInvitation: (...a: unknown[]) => resendInvitation(...a),
  revokeInvitation: (...a: unknown[]) => revokeInvitation(...a),
}));

import { ProjectInviteCard } from "@/components/project/project-invite-card";

const FUTURE = "2099-01-01T00:00:00.000Z";
const LONG_AGO = "2020-01-01T00:00:00.000Z";
function item(over: Record<string, unknown>) {
  return {
    invitationId: "i1", kind: "email", email: "a@x.com", role: "collaborator", status: "pending",
    expiresAt: FUTURE, createdAt: LONG_AGO, invitedByName: "林可", lastSentAt: LONG_AGO, sendAttempts: 1,
    lastSendError: null, canResend: true, ...over,
  };
}

function renderCard() {
  return render(<ProjectInviteCard projectId="p1" nameTab={<div data-testid="name-tab-stub">按名字</div>} />);
}

describe("#4788 邀请成员卡", () => {
  beforeEach(() => {
    [listInvitations, createEmailInvitations, issueInviteLink, resendInvitation, revokeInvitation].forEach((m) => m.mockReset());
    listInvitations.mockResolvedValue({ invitations: [] });
  });

  it("三种方式并列；按名字的内容由外部传入", async () => {
    renderCard();
    expect(screen.getByTestId("project-invite-method-name")).toBeInTheDocument();
    expect(screen.getByTestId("project-invite-method-email")).toBeInTheDocument();
    expect(screen.getByTestId("project-invite-method-link")).toBeInTheDocument();
    expect(screen.getByTestId("name-tab-stub")).toBeInTheDocument();
    expect(await screen.findByTestId("project-invite-pending-empty")).toBeInTheDocument();
  });

  it("按邮箱：逐个显示结果，发送失败给出人话原因并可重发", async () => {
    createEmailInvitations.mockResolvedValue({ invitations: [
      { email: "ok@x.com", invitationId: "n1", outcome: "sent", lastSendError: null },
      { email: "bad@x.com", invitationId: "n2", outcome: "send_failed", lastSendError: "MAIL_SEND_FAILED" },
      { email: "dup@x.com", invitationId: null, outcome: "already_pending", lastSendError: null },
      { email: "in@x.com", invitationId: null, outcome: "already_member", lastSendError: null },
      { email: "nope", invitationId: null, outcome: "invalid_email", lastSendError: null },
    ] });
    resendInvitation.mockResolvedValue({ invitationId: "n2", outcome: "sent", lastSendError: null, sendAttempts: 2, lastSentAt: LONG_AGO, remainingSends: 3 });
    renderCard();
    fireEvent.click(screen.getByTestId("project-invite-method-email"));
    fireEvent.change(screen.getByTestId("project-invite-email-input"), { target: { value: "ok@x.com, bad@x.com\ndup@x.com in@x.com nope OK@x.com" } });
    expect(screen.getByTestId("project-invite-email-submit")).toHaveTextContent("（5）"); // 去重后 5 个
    fireEvent.click(screen.getByTestId("project-invite-email-submit"));
    await screen.findByTestId("project-invite-email-results");
    expect(createEmailInvitations).toHaveBeenCalledWith("p1", ["ok@x.com", "bad@x.com", "dup@x.com", "in@x.com", "nope"]);
    expect(screen.getByTestId("project-invite-email-outcome-0")).toHaveTextContent("已发送");
    expect(screen.getByTestId("project-invite-email-outcome-1")).toHaveTextContent("发送失败");
    expect(screen.getByTestId("project-invite-email-reason-1")).toHaveTextContent("邮件发送失败，请稍后点「重发」再试");
    expect(screen.getByTestId("project-invite-email-outcome-2")).toHaveTextContent("已有待处理邀请");
    expect(screen.getByTestId("project-invite-email-outcome-3")).toHaveTextContent("已在项目里");
    expect(screen.getByTestId("project-invite-email-outcome-4")).toHaveTextContent("邮箱格式不对");
    expect(screen.queryByTestId("project-invite-email-resend-0")).toBeNull();
    fireEvent.click(screen.getByTestId("project-invite-email-resend-1"));
    await waitFor(() => expect(screen.getByTestId("project-invite-email-outcome-1")).toHaveTextContent("已发送"));
    expect(resendInvitation).toHaveBeenCalledWith("p1", "n2");
    expect(screen.queryByTestId("project-invite-email-reason-1")).toBeNull();
    expect(listInvitations.mock.calls.length).toBeGreaterThan(1); // 写后重新拉列表
  });

  it("按邮箱：超过 20 个禁用提交；整批被拒显示契约人话", async () => {
    renderCard();
    fireEvent.click(screen.getByTestId("project-invite-method-email"));
    const many = Array.from({ length: 21 }, (_, i) => `u${i}@x.com`).join("\n");
    fireEvent.change(screen.getByTestId("project-invite-email-input"), { target: { value: many } });
    expect(screen.getByTestId("project-invite-email-submit")).toBeDisabled();
    expect(screen.getByTestId("project-invite-email-toomany")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("project-invite-email-input"), { target: { value: "a@x.com" } });
    createEmailInvitations.mockRejectedValue(new ApiError(429, "DAILY_CAP_REACHED", { reasonCode: "DAILY_CAP_REACHED" }));
    fireEvent.click(screen.getByTestId("project-invite-email-submit"));
    expect(await screen.findByTestId("project-invite-email-error")).toHaveTextContent("今天这个项目发出的邀请已达上限");
  });

  it("按链接：生成 → 显示链接与有效期 → 复制 → 重置要先确认，重置后显示新链接", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    issueInviteLink
      .mockResolvedValueOnce({ invitationId: "L1", inviteUrl: "https://x.test/projects/join?invite=AAA", expiresAt: FUTURE, replacedInvitationId: null })
      .mockResolvedValueOnce({ invitationId: "L2", inviteUrl: "https://x.test/projects/join?invite=BBB", expiresAt: FUTURE, replacedInvitationId: "L1" });
    renderCard();
    fireEvent.click(screen.getByTestId("project-invite-method-link"));
    expect(screen.getByTestId("project-invite-url-warning")).toHaveTextContent("也会成为这个组织的成员");
    fireEvent.click(screen.getByTestId("project-invite-url-generate"));
    const input = (await screen.findByTestId("project-invite-url-value")) as HTMLInputElement;
    expect(input.value).toContain("invite=AAA");
    expect(screen.getByTestId("project-invite-url-expiry")).toHaveTextContent("有效期至");
    fireEvent.click(screen.getByTestId("project-invite-url-copy"));
    await waitFor(() => expect(screen.getByTestId("project-invite-url-copy")).toHaveTextContent("已复制"));
    expect(writeText).toHaveBeenCalledWith("https://x.test/projects/join?invite=AAA");
    fireEvent.click(screen.getByTestId("project-invite-url-reset"));
    expect(issueInviteLink).toHaveBeenCalledTimes(1); // 只是进入确认，还没重置
    fireEvent.click(screen.getByTestId("project-invite-url-reset-yes"));
    await waitFor(() => expect((screen.getByTestId("project-invite-url-value") as HTMLInputElement).value).toContain("invite=BBB"));
    expect(screen.getByTestId("project-invite-url-replaced")).toBeInTheDocument();
  });

  it("按链接：刷新后已有有效链接 ⇒ 说明原链接不再显示，只能重置", async () => {
    listInvitations.mockResolvedValue({ invitations: [item({ invitationId: "L1", kind: "link", email: null })] });
    renderCard();
    fireEvent.click(screen.getByTestId("project-invite-method-link"));
    expect(await screen.findByTestId("project-invite-url-existing")).toBeInTheDocument();
    expect(screen.queryByTestId("project-invite-url-generate")).toBeNull();
    expect(screen.getByTestId("project-invite-url-reset")).toBeInTheDocument();
  });

  it("待处理邀请：状态 / 邀请人 / 失败原因 / 剩余次数；链接邀请没有重发", async () => {
    listInvitations.mockResolvedValue({ invitations: [
      item({ invitationId: "e1", lastSendError: "MAIL_RECIPIENT_REJECTED", sendAttempts: 2 }),
      item({ invitationId: "l1", kind: "link", email: null, canResend: false, sendAttempts: 0, lastSentAt: null }),
      item({ invitationId: "x1", status: "accepted", canResend: false, email: "done@x.com" }),
      item({ invitationId: "x2", status: "expired", canResend: false, email: "old@x.com" }),
      item({ invitationId: "x3", status: "revoked", canResend: false, email: "gone@x.com" }),
    ] });
    renderCard();
    await screen.findByTestId("project-invite-pending-list");
    expect(screen.getByTestId("project-invite-item-target-e1")).toHaveTextContent("a@x.com");
    expect(screen.getByTestId("project-invite-item-status-e1")).toHaveTextContent("待接受");
    expect(screen.getByTestId("project-invite-item-meta-e1")).toHaveTextContent("林可 邀请");
    expect(screen.getByTestId("project-invite-item-meta-e1")).toHaveTextContent("已发送 2 次");
    expect(screen.getByTestId("project-invite-item-failure-e1")).toHaveTextContent("拒收了这封邮件");
    expect(screen.getByTestId("project-invite-item-remaining-e1")).toHaveTextContent("还可重发 3 次");
    expect(screen.getByTestId("project-invite-item-resend-e1")).toBeEnabled();
    expect(screen.getByTestId("project-invite-item-target-l1")).toHaveTextContent("链接");
    expect(screen.queryByTestId("project-invite-item-resend-l1")).toBeNull();
    expect(screen.getByTestId("project-invite-item-status-x1")).toHaveTextContent("已接受");
    expect(screen.getByTestId("project-invite-item-status-x2")).toHaveTextContent("已过期");
    expect(screen.getByTestId("project-invite-item-status-x3")).toHaveTextContent("已撤销");
    expect(screen.queryByTestId("project-invite-item-revoke-x1")).toBeNull(); // 只有待接受能撤销
  });

  it("待处理邀请：不能重发时禁用并写明原因（到上限 / canResend=false / 冷却中）", async () => {
    listInvitations.mockResolvedValue({ invitations: [
      item({ invitationId: "cap", sendAttempts: 5, canResend: false }),
      item({ invitationId: "no", canResend: false }),
      item({ invitationId: "hot", lastSentAt: new Date().toISOString() }),
    ] });
    renderCard();
    await screen.findByTestId("project-invite-pending-list");
    expect(screen.getByTestId("project-invite-item-resend-cap")).toBeDisabled();
    expect(screen.getByTestId("project-invite-item-resend-reason-cap")).toHaveTextContent("已经发送了 5 次");
    expect(screen.getByTestId("project-invite-item-resend-no")).toBeDisabled();
    expect(screen.getByTestId("project-invite-item-resend-reason-no")).toBeInTheDocument();
    expect(screen.getByTestId("project-invite-item-resend-hot")).toBeDisabled();
    expect(screen.getByTestId("project-invite-item-resend-reason-hot")).toHaveTextContent("秒后再重发");
  });

  it("重发：成功后提示剩余次数并重新拉列表；被限频时显示人话", async () => {
    listInvitations.mockResolvedValue({ invitations: [item({ invitationId: "e1" })] });
    resendInvitation.mockResolvedValueOnce({ invitationId: "e1", outcome: "sent", lastSendError: null, sendAttempts: 2, lastSentAt: LONG_AGO, remainingSends: 3 });
    renderCard();
    await screen.findByTestId("project-invite-item-resend-e1");
    fireEvent.click(screen.getByTestId("project-invite-item-resend-e1"));
    expect(await screen.findByTestId("project-invite-item-note-e1")).toHaveTextContent("还可重发 3 次");
    resendInvitation.mockRejectedValueOnce(new ApiError(429, "RESEND_TOO_SOON", { reasonCode: "RESEND_TOO_SOON", retryAfterSeconds: 30 }));
    fireEvent.click(screen.getByTestId("project-invite-item-resend-e1"));
    expect(await screen.findByTestId("project-invite-item-error-e1")).toHaveTextContent("秒后再重发");
  });

  it("撤销：先确认再调用；取消则不调用", async () => {
    listInvitations.mockResolvedValue({ invitations: [item({ invitationId: "e1" })] });
    revokeInvitation.mockResolvedValue({ invitationId: "e1", status: "revoked" });
    renderCard();
    await screen.findByTestId("project-invite-item-revoke-e1");
    fireEvent.click(screen.getByTestId("project-invite-item-revoke-e1"));
    fireEvent.click(screen.getByTestId("project-invite-item-revoke-no-e1"));
    expect(revokeInvitation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("project-invite-item-revoke-e1"));
    expect(within(screen.getByTestId("project-invite-item-revoke-confirm-e1")).getByText(/立刻失效/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("project-invite-item-revoke-yes-e1"));
    await waitFor(() => expect(revokeInvitation).toHaveBeenCalledWith("p1", "e1"));
    await waitFor(() => expect(listInvitations.mock.calls.length).toBeGreaterThan(1));
  });

  it("待处理邀请：读取失败显示错误并可重试", async () => {
    listInvitations.mockRejectedValueOnce(new ApiError(500, null, undefined, "boom"));
    renderCard();
    expect(await screen.findByTestId("project-invite-pending-error")).toHaveTextContent("服务器出错了");
    listInvitations.mockResolvedValue({ invitations: [] });
    fireEvent.click(screen.getByTestId("project-invite-pending-retry"));
    expect(await screen.findByTestId("project-invite-pending-empty")).toBeInTheDocument();
  });
});
