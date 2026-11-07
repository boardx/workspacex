import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";
const state = vi.hoisted(() => ({ invite: vi.fn() }));
vi.mock("@/lib/live-org-admin", async (original) => ({
  ...await original<typeof import("@/lib/live-org-admin")>(), inviteOrgMember: state.invite,
}));
import { InviteMemberForm } from "@/components/org-admin/org-admin-screen";
beforeEach(() => { state.invite.mockReset(); });
function submit() {
  const success = vi.fn(), failure = vi.fn(), reveal = vi.fn();
  render(<InviteMemberForm orgId="org" onSucceeded={success} onFailed={failure} onLink={reveal} />);
  expect(screen.queryByTestId("org-admin-invite-role")).toBeNull();
  expect(document.body.textContent).not.toMatch(/尚未接通|复核|顾问/);
  fireEvent.change(screen.getByTestId("org-admin-invite-email"), { target: { value: "person@example.test" } });
  fireEvent.submit(screen.getByTestId("org-admin-invite-form"));
  return { success, failure, reveal };
}
it("sends only ordinary-member invitations and reports email delivery", async () => {
  state.invite.mockResolvedValue({ status: "pending", quotaReserved: 1, activationToken: null });
  const { success, failure, reveal } = submit();
  await waitFor(() => expect(success).toHaveBeenCalledWith("邀请邮件已发送，邀请链接 7 天内有效。"));
  expect(state.invite).toHaveBeenCalledWith({ orgId: "org", email: "person@example.test", orgRole: "consultant", teamId: "" });
  expect(failure).not.toHaveBeenCalled();
  expect(reveal).not.toHaveBeenCalled();
});
it("reports mail failure without claiming the invitation was sent", async () => {
  state.invite.mockRejectedValue(new ApiError(503, "MAIL_UNAVAILABLE", {}));
  const { success, failure, reveal } = submit();
  await waitFor(() => expect(failure).toHaveBeenCalledWith(expect.stringContaining("发送失败")));
  expect(success).not.toHaveBeenCalled();
  expect(reveal).not.toHaveBeenCalled();
});
it("does not claim a duplicate invitation email was sent again", async () => {
  state.invite.mockResolvedValue({ status: "pending", tokenIssued: false, quotaReserved: 0, activationToken: null });
  const { success } = submit();
  await waitFor(() => expect(success).toHaveBeenCalledWith(expect.stringContaining("相同的邀请")));
  expect(success.mock.calls[0]?.[0]).not.toContain("邮件已发送");
});
